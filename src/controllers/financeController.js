import Donation from '../models/Donation.js';
import Expense from '../models/Expense.js';
import { branchFilter, resolveCreateBranch } from '../utils/branchQuery.js';

export const getFinanceOverview = async (req, res) => {
  try {
    // Get total income from donations
    const incomeResult = await Donation.aggregate([
      { $match: branchFilter(req) },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const totalIncome = incomeResult[0]?.total || 0;

    // Get total expenses
    const expenseResult = await Expense.aggregate([
      { $match: branchFilter(req) },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const totalExpenses = expenseResult[0]?.total || 0;

    // Get monthly trends (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const monthlyIncome = await Donation.aggregate([
      { $match: { ...branchFilter(req), donationDate: { $gte: sixMonthsAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$donationDate' } },
          total: { $sum: '$amount' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const monthlyExpenses = await Expense.aggregate([
      { $match: { ...branchFilter(req), date: { $gte: sixMonthsAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$date' } },
          total: { $sum: '$amount' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Merge monthly data
    const monthsSet = new Set([
      ...monthlyIncome.map((m) => m._id),
      ...monthlyExpenses.map((m) => m._id),
    ]);

    const monthlyTrends = Array.from(monthsSet)
      .sort()
      .map((month) => ({
        month,
        income: monthlyIncome.find((m) => m._id === month)?.total || 0,
        expenses: monthlyExpenses.find((m) => m._id === month)?.total || 0,
      }));

    res.json({
      totalIncome,
      totalExpenses,
      netBalance: totalIncome - totalExpenses,
      monthlyTrends,
    });
  } catch (error) {
    console.error('Error fetching finance overview:', error);
    res.status(500).json({ error: 'Failed to fetch finance overview' });
  }
};

export const getFinanceReport = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const dateFilter = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) dateFilter.$lte = new Date(endDate);

    const donationFilter = startDate || endDate ? { ...branchFilter(req), donationDate: dateFilter } : { ...branchFilter(req) };
    const expenseFilter = startDate || endDate ? { ...branchFilter(req), date: dateFilter } : { ...branchFilter(req) };

    const [donations, expenses] = await Promise.all([
      Donation.find(donationFilter)
        .populate('donorId', 'firstName lastName')
        .populate('fundBucketId', 'name')
        .sort({ donationDate: -1 }),
      Expense.find(expenseFilter)
        .populate('approvedBy', 'firstName lastName')
        .sort({ date: -1 }),
    ]);

    const totalIncome = donations.reduce((sum, d) => sum + d.amount, 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

    // Income by type
    const incomeByType = {};
    donations.forEach((d) => {
      const type = d.donationType || 'other';
      incomeByType[type] = (incomeByType[type] || 0) + d.amount;
    });

    // Expenses by category
    const expensesByCategory = {};
    expenses.forEach((e) => {
      expensesByCategory[e.category] = (expensesByCategory[e.category] || 0) + e.amount;
    });

    res.json({
      totalIncome,
      totalExpenses,
      netBalance: totalIncome - totalExpenses,
      incomeByType,
      expensesByCategory,
      donations,
      expenses,
    });
  } catch (error) {
    console.error('Error fetching finance report:', error);
    res.status(500).json({ error: 'Failed to fetch finance report' });
  }
};

export default {
  getFinanceOverview,
  getFinanceReport,
};
