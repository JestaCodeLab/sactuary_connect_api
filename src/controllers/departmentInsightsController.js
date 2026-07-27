import Department from '../models/Department.js';
import Event from '../models/Event.js';
import AttendanceRecord from '../models/AttendanceRecord.js';
import { buildDigest } from '../utils/departmentDigest.js';

// How far back to look for department-tagged attendance when computing the
// attendance component of the health score and the AI digest's trend line.
const ATTENDANCE_LOOKBACK_DAYS = 90;
// Matches the mockup's "absent for three weeks" phrasing
const ABSENCE_WEEKS_THRESHOLD = 3;
const UPCOMING_BIRTHDAY_DAYS = 14;

function computeUpcomingBirthdays(members, days = UPCOMING_BIRTHDAY_DAYS) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const results = [];

  for (const member of members) {
    if (!member.dateOfBirth) continue;
    const dob = new Date(member.dateOfBirth);
    const birthdayThisYear = new Date(now.getFullYear(), dob.getMonth(), dob.getDate());
    let nextBirthday = birthdayThisYear;
    if (birthdayThisYear < today) {
      nextBirthday = new Date(now.getFullYear() + 1, dob.getMonth(), dob.getDate());
    }
    const diffDays = Math.round((nextBirthday.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays >= 0 && diffDays <= days) {
      results.push({
        memberId: member._id,
        name: `${member.firstName} ${member.lastName}`,
        daysUntil: diffDays,
      });
    }
  }

  return results.sort((a, b) => a.daysUntil - b.daysUntil);
}

/**
 * Live insights for a department: health score (attendance + engagement),
 * absence streaks, upcoming birthdays, and upcoming events. Single source of
 * truth for both the health score UI and the AI Ministry Assistant digest.
 */
export const getDepartmentInsights = async (req, res) => {
  try {
    const { id } = req.params;
    const organizationId = req.organizationId;

    const department = await Department.findOne({ _id: id, organizationId })
      .populate('members', 'firstName lastName memberStatus dateOfBirth');

    if (!department) {
      return res.status(404).json({ error: 'Department not found' });
    }

    const members = department.members || [];
    const totalMembers = members.length;

    // --- Engagement component: member status mix ---
    const statusCounts = { active: 0, visiting: 0, inactive: 0, transferred: 0 };
    for (const m of members) {
      if (statusCounts[m.memberStatus] !== undefined) statusCounts[m.memberStatus]++;
    }
    const engagementComponent = totalMembers > 0
      ? Math.round((statusCounts.active * 100 + statusCounts.visiting * 60 + statusCounts.transferred * 20) / totalMembers)
      : null;

    // --- Attendance component: only counts department-tagged events (Event.departmentId) ---
    const deptEvents = await Event.find({ organizationId, departmentId: id }).select('_id').lean();
    const deptEventIds = deptEvents.map((e) => e._id);

    let attendanceComponent = null;
    let currentRatePercent = null;
    let trendDeltaPercent = null;
    let occurrencesConsidered = 0;
    let absences = [];

    if (deptEventIds.length > 0 && totalMembers > 0) {
      const lookbackStart = new Date();
      lookbackStart.setDate(lookbackStart.getDate() - ATTENDANCE_LOOKBACK_DAYS);

      const matchStage = {
        eventId: { $in: deptEventIds },
        createdAt: { $gte: lookbackStart },
      };

      // A "service" is identified by its event, plus the occurrence date for
      // recurring events, so each occurrence (e.g. each meeting) counts separately.
      const occurrenceKey = {
        $concat: [
          { $toString: '$eventId' },
          '_',
          { $dateToString: { format: '%Y-%m-%d', date: '$occurrenceDate', onNull: 'single' } },
        ],
      };

      const occurrenceDocs = await AttendanceRecord.aggregate([
        { $match: matchStage },
        { $group: { _id: occurrenceKey, date: { $min: '$createdAt' } } },
        { $sort: { date: 1 } },
      ]);

      occurrencesConsidered = occurrenceDocs.length;

      if (occurrencesConsidered > 0) {
        const attendanceDocs = await AttendanceRecord.aggregate([
          { $match: { ...matchStage, memberId: { $ne: null } } },
          { $group: { _id: { memberId: '$memberId', occurrence: occurrenceKey } } },
        ]);

        currentRatePercent = Math.round((attendanceDocs.length / (occurrencesConsidered * totalMembers)) * 100);
        attendanceComponent = Math.min(100, Math.max(0, currentRatePercent));

        // Trend: compare the earlier half of the lookback window's occurrences vs. the later half
        const mid = Math.floor(occurrenceDocs.length / 2);
        const earlierIds = new Set(occurrenceDocs.slice(0, mid).map((d) => d._id));
        const laterIds = new Set(occurrenceDocs.slice(mid).map((d) => d._id));

        if (earlierIds.size > 0 && laterIds.size > 0) {
          let earlierAttended = 0;
          let laterAttended = 0;
          for (const doc of attendanceDocs) {
            if (earlierIds.has(doc._id.occurrence)) earlierAttended++;
            if (laterIds.has(doc._id.occurrence)) laterAttended++;
          }
          const earlierRate = earlierAttended / (earlierIds.size * totalMembers);
          const laterRate = laterAttended / (laterIds.size * totalMembers);
          trendDeltaPercent = Math.round((laterRate - earlierRate) * 100);
        }

        const attendedCountByMember = new Map();
        for (const doc of attendanceDocs) {
          const key = String(doc._id.memberId);
          attendedCountByMember.set(key, (attendedCountByMember.get(key) || 0) + 1);
        }
        absences = members
          .map((m) => {
            const attended = attendedCountByMember.get(String(m._id)) || 0;
            return {
              memberId: m._id,
              name: `${m.firstName} ${m.lastName}`,
              weeksAbsent: Math.max(0, occurrencesConsidered - attended),
            };
          })
          .filter((m) => m.weeksAbsent >= ABSENCE_WEEKS_THRESHOLD)
          .sort((a, b) => b.weeksAbsent - a.weeksAbsent);
      }
    }

    // Not enough data yet - surface as null rather than a misleading score
    const healthScore = (attendanceComponent !== null && engagementComponent !== null)
      ? Math.round(0.6 * attendanceComponent + 0.4 * engagementComponent)
      : null;

    const upcomingBirthdays = computeUpcomingBirthdays(members);

    const now = new Date();
    const upcomingEventDocs = await Event.find({
      organizationId,
      departmentId: id,
      status: { $in: ['scheduled', 'ongoing'] },
      startDate: { $gte: now },
    }).sort({ startDate: 1 }).select('title startDate').lean();

    const insights = {
      healthScore,
      healthScoreBreakdown: { attendanceComponent, engagementComponent },
      attendance: { currentRatePercent, trendDeltaPercent, occurrencesConsidered },
      engagement: { totalMembers, ...statusCounts },
      absences,
      upcomingBirthdays,
      upcomingEvents: {
        count: upcomingEventDocs.length,
        next: upcomingEventDocs[0] ? { title: upcomingEventDocs[0].title, startDate: upcomingEventDocs[0].startDate } : null,
      },
    };

    insights.digest = buildDigest(insights, department.name, String(department._id));

    res.json(insights);
  } catch (error) {
    console.error('Error fetching department insights:', error);
    res.status(500).json({ error: 'Failed to fetch department insights' });
  }
};

export default { getDepartmentInsights };
