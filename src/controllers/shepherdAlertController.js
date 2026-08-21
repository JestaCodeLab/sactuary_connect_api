import mongoose from 'mongoose';
import ShepherdAlert from '../models/ShepherdAlert.js';
import ShepherdAlertLog from '../models/ShepherdAlertLog.js';
import AttendanceRecord from '../models/AttendanceRecord.js';
import Member from '../models/Member.js';
import smsService from '../services/smsService.js';
import { normalizePhone } from '../utils/phoneUtils.js';
import { branchFilter, resolveCreateBranch } from '../utils/branchQuery.js';

const LOOKBACK_MIN_DAYS = 1;
const LOOKBACK_MAX_DAYS = 365;

/**
 * Get all shepherd alerts for an organization, scoped to the selected
 * branch (or the user's assigned branches) the same way events/members are.
 */
export const getShepherdAlerts = async (req, res) => {
  try {
    const { isActive } = req.query;

    const filter = branchFilter(req);
    if (isActive !== undefined) filter.isActive = isActive === 'true';

    const alerts = await ShepherdAlert.find(filter)
      .populate('shepherds.memberId', 'firstName lastName phone')
      .populate('branchId', 'name')
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
    const organizationId = req.organizationId;

    const alert = await ShepherdAlert.findOne({
      _id: id,
      organizationId,
    })
      .populate('shepherds.memberId', 'firstName lastName phone')
      .populate('branchId', 'name');

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
    const organizationId = req.organizationId;
    const {
      name,
      shepherds,
      absenceThreshold = 3,
      lookbackPeriodDays = 30,
    } = req.body;

    // Validate required fields
    if (!name?.trim()) {
      return res.status(400).json({ error: 'Alert name is required' });
    }

    const branchId = resolveCreateBranch(req);
    if (!branchId) {
      return res.status(400).json({ error: 'Branch is required' });
    }

    if (!shepherds || shepherds.length === 0) {
      return res.status(400).json({ error: 'At least one shepherd must be notified' });
    }

    if (absenceThreshold < 1 || absenceThreshold > 10) {
      return res.status(400).json({ error: 'Absence threshold must be between 1 and 10' });
    }

    if (lookbackPeriodDays < LOOKBACK_MIN_DAYS || lookbackPeriodDays > LOOKBACK_MAX_DAYS) {
      return res.status(400).json({ error: `Lookback period must be between ${LOOKBACK_MIN_DAYS} and ${LOOKBACK_MAX_DAYS} days` });
    }

    // Verify shepherd members exist
    const shepherdMembers = await Member.find({
      _id: { $in: shepherds.map(s => s.memberId) },
      organizationId,
    });

    if (shepherdMembers.length !== shepherds.length) {
      return res.status(400).json({ error: 'Some specified shepherds do not exist' });
    }

    const normalizedShepherds = shepherds.map(s => ({
      ...s,
      phoneNumber: normalizePhone(s.phoneNumber),
    }));

    // Create alert (monitors all members in this branch)
    const alert = new ShepherdAlert({
      organizationId,
      branchId,
      name,
      shepherds: normalizedShepherds,
      absenceThreshold,
      lookbackPeriodDays,
    });

    await alert.save();
    await alert.populate('shepherds.memberId', 'firstName lastName phone');
    await alert.populate('branchId', 'name');

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
    const organizationId = req.organizationId;
    const updates = { ...req.body };

    // Only these fields are client-settable - strip everything else (in
    // particular organizationId, totalAlertsTriggered, smsSentCount, lastCheckAt,
    // which were previously mass-assignable straight from the request body).
    const ALLOWED_FIELDS = ['name', 'shepherds', 'absenceThreshold', 'lookbackPeriodDays', 'branchId', 'isActive'];
    Object.keys(updates).forEach((key) => {
      if (!ALLOWED_FIELDS.includes(key)) {
        delete updates[key];
      }
    });

    // branchId is required on every alert - block clearing it via update
    // (the field is still editable to reassign the alert to a different branch)
    if ('branchId' in updates && !updates.branchId) {
      return res.status(400).json({ error: 'Branch is required' });
    }

    // Validate absence threshold if provided
    if (updates.absenceThreshold !== undefined) {
      if (updates.absenceThreshold < 1 || updates.absenceThreshold > 10) {
        return res.status(400).json({ error: 'Absence threshold must be between 1 and 10' });
      }
    }

    if (updates.lookbackPeriodDays !== undefined) {
      if (updates.lookbackPeriodDays < LOOKBACK_MIN_DAYS || updates.lookbackPeriodDays > LOOKBACK_MAX_DAYS) {
        return res.status(400).json({ error: `Lookback period must be between ${LOOKBACK_MIN_DAYS} and ${LOOKBACK_MAX_DAYS} days` });
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

      updates.shepherds = updates.shepherds.map(s => ({
        ...s,
        phoneNumber: normalizePhone(s.phoneNumber),
      }));
    }

    const alert = await ShepherdAlert.findOneAndUpdate(
      { _id: id, organizationId },
      updates,
      { new: true }
    )
      .populate('shepherds.memberId', 'firstName lastName phone')
      .populate('branchId', 'name');

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
    const organizationId = req.organizationId;

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
    const organizationId = req.organizationId;

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
    const organizationId = req.organizationId;

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
        smsFailed: logs.filter(l => l.smsAttempted && !l.smsSent).length,
        suppressed: logs.filter(l => l.triggerred && !l.smsAttempted).length,
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
    const organizationId = req.organizationId;
    const { shepherdAlertId, memberId, triggered, runLimit } = req.query;

    const filter = { organizationId };
    if (shepherdAlertId) filter.shepherdAlertId = shepherdAlertId;
    if (memberId) filter.memberId = memberId;
    if (triggered !== undefined) filter.triggerred = triggered === 'true';

    // When scoped to a single alert, page by *run* (checkPeriodEnd) instead
    // of by individual log row. Each executeShepherdAlertCheck() run writes
    // one log per member checked - a single run can easily be 100+ logs for
    // a large org, so a flat row-count limit could cut off partway through
    // a run (some members shown, others silently missing) instead of
    // cleanly stopping between runs.
    if (shepherdAlertId) {
      const limit = Math.min(parseInt(runLimit, 10) || 10, 50);

      const distinctRuns = await ShepherdAlertLog.distinct('checkPeriodEnd', filter);
      const sortedRuns = distinctRuns.sort((a, b) => new Date(b) - new Date(a));
      const pageRuns = sortedRuns.slice(0, limit);

      const logs = pageRuns.length > 0
        ? await ShepherdAlertLog.find({ ...filter, checkPeriodEnd: { $in: pageRuns } })
            .populate('shepherdAlertId', 'name')
            .populate('memberId', 'firstName lastName')
            .populate('eventId', 'name')
            .sort({ checkPeriodEnd: -1, createdAt: -1 })
        : [];

      return res.json({ logs, totalRuns: sortedRuns.length, runsReturned: pageRuns.length });
    }

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
 * Counts absences per member across distinct services held in the lookback
 * window (org/branch-scoped) and triggers SMS if the threshold is met
 */
async function executeShepherdAlertCheck(alert, organizationId) {
  const lookbackStart = new Date();
  lookbackStart.setDate(lookbackStart.getDate() - alert.lookbackPeriodDays);
  const checkPeriodEnd = new Date();

  try {
    const matchStage = {
      organizationId: new mongoose.Types.ObjectId(organizationId),
      createdAt: { $gte: lookbackStart },
    };
    if (alert.branchId) {
      matchStage.branchId = new mongoose.Types.ObjectId(alert.branchId);
    }

    // A "service" is identified by its event, plus the occurrence date for
    // recurring events, so each occurrence (e.g. each Sunday) counts separately.
    const occurrenceKey = {
      $concat: [
        { $toString: '$eventId' },
        '_',
        { $dateToString: { format: '%Y-%m-%d', date: '$occurrenceDate', onNull: 'single' } },
      ],
    };

    // Every distinct service held in the lookback window (org/branch-scoped)
    const occurrenceDocs = await AttendanceRecord.aggregate([
      { $match: matchStage },
      { $group: { _id: occurrenceKey } },
    ]);
    const totalOccurrences = occurrenceDocs.length;

    // Nothing to measure attendance against yet - skip rather than firing false alerts
    if (totalOccurrences === 0) {
      alert.lastCheckAt = new Date();
      await alert.save();
      return [];
    }

    // Per-member count of distinct services they personally attended
    const attendanceDocs = await AttendanceRecord.aggregate([
      { $match: { ...matchStage, memberId: { $ne: null } } },
      { $group: { _id: { memberId: '$memberId', occurrence: occurrenceKey } } },
      { $group: { _id: '$_id.memberId', attendedCount: { $sum: 1 } } },
    ]);
    const attendanceByMember = new Map(
      attendanceDocs.map(doc => [String(doc._id), doc.attendedCount])
    );

    const memberFilter = { organizationId };
    if (alert.branchId) memberFilter.branchId = alert.branchId;
    const members = await Member.find(memberFilter).lean();

    const logsToInsert = [];
    // Members newly-triggered (and not cooldown-suppressed) this run, collected
    // so shepherds get ONE digest SMS listing everyone instead of one SMS per member.
    const membersToNotify = [];

    for (const member of members) {
      // A member who joined after this lookback window started hasn't had a full
      // window's worth of opportunity to attend - counting every occurrence before
      // they existed as an "absence" would falsely flag brand-new members.
      const joinDate = member.membershipDate || member.createdAt;
      if (joinDate && new Date(joinDate) > lookbackStart) {
        continue;
      }

      const attendedCount = attendanceByMember.get(String(member._id)) || 0;
      const absenceCount = Math.max(0, totalOccurrences - attendedCount);
      const memberName = `${member.firstName} ${member.lastName}`;

      const logData = {
        organizationId,
        shepherdAlertId: alert._id,
        memberId: member._id,
        memberName,
        memberPhone: member.phone,
        absenceCount,
        absenceThreshold: alert.absenceThreshold,
        lookbackPeriodDays: alert.lookbackPeriodDays,
        checkPeriodStart: lookbackStart,
        checkPeriodEnd,
        triggerred: false,
        smsAttempted: false,
        smsSent: false,
        recipientsNotified: [],
      };

      // Check if threshold is met
      if (absenceCount >= alert.absenceThreshold) {
        logData.triggerred = true;
        logData.smsMessage = `Attendance Alert: ${memberName} has been absent ${absenceCount} times in the last ${alert.lookbackPeriodDays} days.`;

        // Cooldown: don't re-alert about the same member on this alert more than
        // once per lookback period - without this, a persistently-absent member's
        // shepherd would get a fresh SMS every single day the check runs.
        // eslint-disable-next-line no-await-in-loop
        const alreadyAlerted = await ShepherdAlertLog.exists({
          organizationId,
          shepherdAlertId: alert._id,
          memberId: member._id,
          triggerred: true,
          createdAt: { $gte: lookbackStart },
        });

        if (alreadyAlerted) {
          logData.error = `Suppressed: already alerted about this member within the last ${alert.lookbackPeriodDays} days`;
        } else {
          membersToNotify.push({ logData, memberName, absenceCount });
        }
      }

      logsToInsert.push(logData);
    }

    // Send ONE consolidated digest SMS per shepherd listing every member
    // newly-triggered this run, instead of one SMS per absent member -
    // applies the same way whether this run came from the daily cron or a
    // manual "Run Check" trigger, since both share this function.
    if (membersToNotify.length > 0) {
      const digestPayload = membersToNotify.map(({ memberName, absenceCount }) => ({ memberName, absenceCount }));

      for (const shepherd of alert.shepherds) {
        let smsResult;
        try {
          // eslint-disable-next-line no-await-in-loop
          smsResult = await smsService.sendShepherdAlertDigestSms(
            shepherd.phoneNumber,
            digestPayload,
            alert.lookbackPeriodDays,
            organizationId
          );
        } catch (shepherdError) {
          console.error(`Error sending digest SMS to shepherd ${shepherd.phoneNumber}:`, shepherdError);
          smsResult = { success: false, error: shepherdError.message };
        }

        if (!smsResult.success) {
          console.warn(`Failed to send shepherd alert digest SMS: ${smsResult.error}`);
        }

        const recipientEntry = {
          memberId: shepherd.memberId,
          phoneNumber: shepherd.phoneNumber,
          status: smsResult.success ? 'sent' : 'failed',
        };

        for (const { logData } of membersToNotify) {
          logData.smsAttempted = true;
          logData.recipientsNotified.push(recipientEntry);
          if (smsResult.success) {
            logData.smsSent = true;
            logData.smsReference = smsResult.reference;
          } else {
            logData.error = smsResult.error;
          }
        }
      }
    }

    const savedLogs = logsToInsert.length > 0 ? await ShepherdAlertLog.insertMany(logsToInsert) : [];

    // Update last check time and stats
    alert.lastCheckAt = new Date();
    alert.totalAlertsTriggered += savedLogs.filter(l => l.triggerred).length;
    alert.smsSentCount += savedLogs.filter(l => l.smsSent).length;
    await alert.save();

    return savedLogs;
  } catch (error) {
    console.error('Error executing shepherd alert check:', error);
    throw error;
  }
}

export { executeShepherdAlertCheck };

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
