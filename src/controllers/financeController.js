import Donation from '../models/Donation.js';
import Expense from '../models/Expense.js';
import Transaction from '../models/Transaction.js';
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

    // Income by payment method
    const incomeByMethod = await Donation.aggregate([
      { $match: branchFilter(req) },
      {
        $group: {
          _id: '$paymentMethod',
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { total: -1 } },
    ]);

    // Monthly totals (current month)
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthlyIncomeResult = await Donation.aggregate([
      { $match: { ...branchFilter(req), donationDate: { $gte: monthStart } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const monthlyIncomeTotalCurrent = monthlyIncomeResult[0]?.total || 0;

    const monthlyExpenseResult = await Expense.aggregate([
      { $match: { ...branchFilter(req), date: { $gte: monthStart } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const monthlyExpenseTotalCurrent = monthlyExpenseResult[0]?.total || 0;

    // YTD totals
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const ytdIncomeResult = await Donation.aggregate([
      { $match: { ...branchFilter(req), donationDate: { $gte: yearStart } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const ytdIncome = ytdIncomeResult[0]?.total || 0;

    const ytdExpenseResult = await Expense.aggregate([
      { $match: { ...branchFilter(req), date: { $gte: yearStart } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const ytdExpenses = ytdExpenseResult[0]?.total || 0;

    res.json({
      totalIncome,
      totalExpenses,
      netBalance: totalIncome - totalExpenses,
      monthlyTrends,
      incomeByMethod: incomeByMethod.map((m) => ({
        method: m._id || 'unknown',
        total: m.total,
        count: m.count,
      })),
      monthly: {
        income: monthlyIncomeTotalCurrent,
        expenses: monthlyExpenseTotalCurrent,
        net: monthlyIncomeTotalCurrent - monthlyExpenseTotalCurrent,
      },
      ytd: {
        income: ytdIncome,
        expenses: ytdExpenses,
        net: ytdIncome - ytdExpenses,
      },
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

export const getTransactions = async (req, res) => {
  try {
    const { type, direction, status, startDate, endDate, page = 1, limit = 20 } = req.query;

    const filter = branchFilter(req);
    if (type) filter.type = type;
    if (direction) filter.direction = direction;
    if (status) filter.status = status;
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const [transactions, total] = await Promise.all([
      Transaction.find(filter)
        .populate('initiatedBy', 'firstName lastName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Transaction.countDocuments(filter),
    ]);

    res.json({
      transactions,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
};

export const getTransactionSummary = async (req, res) => {
  try {
    const { type, startDate, endDate } = req.query;

    const filter = branchFilter(req);
    if (type) filter.type = type;
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const [summary, byType] = await Promise.all([
      Transaction.aggregate([
        { $match: filter },
        {
          $group: {
            _id: '$direction',
            total: { $sum: '$amount' },
            count: { $sum: 1 },
          },
        },
      ]),
      Transaction.aggregate([
        { $match: filter },
        {
          $group: {
            _id: { type: '$type', direction: '$direction' },
            total: { $sum: '$amount' },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const inflow = summary.find((s) => s._id === 'inflow');
    const outflow = summary.find((s) => s._id === 'outflow');

    res.json({
      totalInflow: inflow?.total || 0,
      totalOutflow: outflow?.total || 0,
      net: (inflow?.total || 0) - (outflow?.total || 0),
      totalCount: (inflow?.count || 0) + (outflow?.count || 0),
      byType: byType.map((t) => ({
        type: t._id.type,
        direction: t._id.direction,
        total: t.total,
        count: t.count,
      })),
    });
  } catch (error) {
    console.error('Error fetching transaction summary:', error);
    res.status(500).json({ error: 'Failed to fetch transaction summary' });
  }
};

export const getTransactionById = async (req, res) => {
  try {
    const transaction = await Transaction.findOne({
      _id: req.params.id,
      ...branchFilter(req),
    }).populate('initiatedBy', 'firstName lastName');

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.json(transaction);
  } catch (error) {
    console.error('Error fetching transaction:', error);
    res.status(500).json({ error: 'Failed to fetch transaction' });
  }
};

export default {
  getFinanceOverview,
  getFinanceReport,
  getTransactions,
  getTransactionSummary,
  getTransactionById,
};
