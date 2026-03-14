import Expense from '../models/Expense.js';
import Transaction from '../models/Transaction.js';
import { branchFilter, resolveCreateBranch } from '../utils/branchQuery.js';

export const getAllExpenses = async (req, res) => {
  try {
    const expenses = await Expense.find(branchFilter(req))
      .populate('approvedBy', 'firstName lastName')
      .sort({ date: -1 });
    res.json(expenses);
  } catch (error) {
    console.error('Error fetching expenses:', error);
    res.status(500).json({ error: 'Failed to fetch expenses' });
  }
};

export const getExpenseById = async (req, res) => {
  try {
    const { id } = req.params;
    const expense = await Expense.findById(id)
      .populate('approvedBy', 'firstName lastName');

    if (!expense) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    res.json(expense);
  } catch (error) {
    console.error('Error fetching expense:', error);
    res.status(500).json({ error: 'Failed to fetch expense' });
  }
};

export const createExpense = async (req, res) => {
  try {
    const { amount, category, description, date, vendor, receiptUrl, paymentMethod } = req.body;

    if (!amount || !category || !date) {
      return res.status(400).json({ error: 'Amount, category, and date are required' });
    }

    const branchId = resolveCreateBranch(req);
    if (!branchId) {
      return res.status(400).json({ error: 'Branch is required' });
    }

    const expense = await Expense.create({
      organizationId: req.organizationId,
      branchId,
      amount,
      category,
      description,
      date,
      vendor,
      receiptUrl,
      paymentMethod,
      approvedBy: req.user.userId,
    });

    // Record in unified transaction ledger
    await Transaction.create({
      organizationId: req.organizationId,
      branchId,
      type: 'expense',
      direction: 'outflow',
      amount,
      currency: 'GHS',
      status: 'completed',
      paymentMethod,
      relatedModel: 'Expense',
      relatedId: expense._id,
      description: `${category} expense${vendor ? ` - ${vendor}` : ''}`,
      initiatedBy: req.user.userId,
      metadata: { category, vendor },
    });

    res.status(201).json(expense);
  } catch (error) {
    console.error('Error creating expense:', error);
    res.status(500).json({ error: 'Failed to create expense' });
  }
};

export const updateExpense = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body, updatedAt: Date.now() };
    delete updates._id;
    delete updates.organizationId;
    delete updates.branchId;

    const expense = await Expense.findByIdAndUpdate(id, updates, { new: true })
      .populate('approvedBy', 'firstName lastName');

    if (!expense) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    res.json(expense);
  } catch (error) {
    console.error('Error updating expense:', error);
    res.status(500).json({ error: 'Failed to update expense' });
  }
};

export const deleteExpense = async (req, res) => {
  try {
    const { id } = req.params;
    const expense = await Expense.findByIdAndDelete(id);

    if (!expense) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    res.json({ message: 'Expense deleted successfully' });
  } catch (error) {
    console.error('Error deleting expense:', error);
    res.status(500).json({ error: 'Failed to delete expense' });
  }
};

export const getExpenseStats = async (req, res) => {
  try {
    const stats = await Expense.aggregate([
      { $match: branchFilter(req) },
      {
        $group: {
          _id: '$category',
          totalAmount: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { totalAmount: -1 } },
    ]);

    const totalExpenses = stats.reduce((sum, s) => sum + s.totalAmount, 0);

    res.json({ categories: stats, totalExpenses });
  } catch (error) {
    console.error('Error fetching expense stats:', error);
    res.status(500).json({ error: 'Failed to fetch expense stats' });
  }
};

export default {
  getAllExpenses,
  getExpenseById,
  createExpense,
  updateExpense,
  deleteExpense,
  getExpenseStats,
};
