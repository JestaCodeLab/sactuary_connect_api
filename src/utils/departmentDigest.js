// Templated (non-LLM) "AI Ministry Assistant" digest. Formats the real numbers
// already computed by departmentInsightsController into the sentence/greeting/
// suggestion shape the department detail page renders.

function getAccraHour() {
  const formatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'Africa/Accra' });
  return parseInt(formatter.format(new Date()), 10);
}

function buildGreeting(departmentName) {
  const hour = getAccraHour();
  const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  return `Good ${timeOfDay}, ${departmentName}.`;
}

/**
 * @param {object} insights - the response body built by getDepartmentInsights
 * @param {string} departmentName
 * @param {string} departmentId
 */
export function buildDigest(insights, departmentName, departmentId) {
  const sentences = [];

  if (insights.attendance.trendDeltaPercent !== null) {
    const delta = insights.attendance.trendDeltaPercent;
    sentences.push(
      `Attendance ${delta >= 0 ? 'increased' : 'decreased'} by ${Math.abs(delta)}% this week.`
    );
  }

  if (insights.absences.length > 0) {
    const count = insights.absences.length;
    sentences.push(
      `${count} member${count !== 1 ? 's have' : ' has'} been absent for 3+ weeks.`
    );
  }

  if (insights.upcomingBirthdays.length > 0) {
    const count = insights.upcomingBirthdays.length;
    sentences.push(
      `${count} birthday${count !== 1 ? 's are' : ' is'} coming up.`
    );
  }

  const hasSomeoneToMessage = insights.absences.length > 0 || insights.upcomingBirthdays.length > 0;
  const followUp = hasSomeoneToMessage ? 'Would you like me to message them?' : null;

  const suggestions = [
    {
      label: 'Create rehearsal reminder',
      action: 'sms',
      initialMessage: `Hi team! Quick reminder about our upcoming ${departmentName} rehearsal - see you there!`,
    },
    {
      label: 'Welcome new member',
      action: 'sms',
      initialMessage: `Welcome to ${departmentName}! We're so glad to have you with us.`,
    },
    {
      label: 'Generate attendance report',
      action: 'link',
      href: '/dashboard/attendance',
    },
    {
      label: 'Plan monthly meeting',
      action: 'link',
      href: `/dashboard/events/new?departmentId=${departmentId}`,
    },
  ];

  return {
    greeting: buildGreeting(departmentName),
    sentences,
    followUp,
    suggestions,
  };
}

export default { buildDigest };
