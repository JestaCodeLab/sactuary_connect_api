import Expense from '../models/Expense.js';
import Transaction from '../models/Transaction.js';
import ExpenseCategory from '../models/ExpenseCategory.js';
import { branchFilter, resolveCreateBranch } from '../utils/branchQuery.js';

export const getAllExpenses = async (req, res) => {
  try {
    const filter = branchFilter(req);
    if (req.query.status) filter.status = req.query.status;

    const expenses = await Expense.find(filter)
      .populate('approvedBy', 'firstName lastName')
      .populate('submittedBy', 'firstName lastName')
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
    const expense = await Expense.findOne({ _id: id, ...branchFilter(req) })
      .populate('approvedBy', 'firstName lastName')
      .populate('submittedBy', 'firstName lastName');

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
    const { amount, category, categoryId, description, date, vendor, receiptUrl, paymentMethod } = req.body;

    if (!amount || (!category && !categoryId) || !date) {
      return res.status(400).json({ error: 'Amount, category, and date are required' });
    }

    const branchId = resolveCreateBranch(req);
    if (!branchId) {
      return res.status(400).json({ error: 'Branch is required' });
    }

    // categoryId (dynamic ExpenseCategory) is the source of truth when present;
    // `category` is kept as a denormalized display string for legacy callers.
    let categoryName = category;
    if (categoryId) {
      const categoryDoc = await ExpenseCategory.findOne({ _id: categoryId, organizationId: req.organizationId, branchId });
      if (!categoryDoc) {
        return res.status(400).json({ error: 'Invalid expense category' });
      }
      categoryName = categoryDoc.name;
    }

    const expense = await Expense.create({
      organizationId: req.organizationId,
      branchId,
      amount,
      category: categoryName,
      categoryId: categoryId || undefined,
      description,
      date,
      vendor,
      receiptUrl,
      paymentMethod,
      status: 'pending',
      submittedBy: req.user.userId,
      statusHistory: [
        {
          status: 'pending',
          changedBy: req.user.userId,
          notes: 'Submitted for approval',
        },
      ],
    });

    // No Transaction ledger entry yet — an unapproved expense isn't real
    // outflow. The ledger entry is created in approveExpense instead.

    res.status(201).json(expense);
  } catch (error) {
    console.error('Error creating expense:', error);
    res.status(500).json({ error: 'Failed to create expense' });
  }
};

export const approveExpense = async (req, res) => {
  try {
    const { id } = req.params;
    const expense = await Expense.findOne({ _id: id, ...branchFilter(req) });

    if (!expense) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    if (expense.status !== 'pending') {
      return res.status(400).json({ error: `Cannot approve expense with status: ${expense.status}` });
    }

    expense.status = 'approved';
    expense.approvedBy = req.user.userId;
    expense.approvedAt = Date.now();
    expense.statusHistory.push({
      status: 'approved',
      changedBy: req.user.userId,
      notes: 'Approved',
    });
    await expense.save();

    // Record in the unified transaction ledger now that it's approved
    await Transaction.create({
      organizationId: expense.organizationId,
      branchId: expense.branchId,
      type: 'expense',
      direction: 'outflow',
      amount: expense.amount,
      currency: 'GHS',
      status: 'completed',
      paymentMethod: expense.paymentMethod,
      relatedModel: 'Expense',
      relatedId: expense._id,
      description: `${expense.category} expense${expense.vendor ? ` - ${expense.vendor}` : ''}`,
      initiatedBy: req.user.userId,
      metadata: { category: expense.category, vendor: expense.vendor },
    });

    res.json(expense);
  } catch (error) {
    console.error('Error approving expense:', error);
    res.status(500).json({ error: 'Failed to approve expense' });
  }
};

export const rejectExpense = async (req, res) => {
  try {
    const { id } = req.params;
    const { rejectionReason } = req.body;

    if (!rejectionReason) {
      return res.status(400).json({ error: 'rejectionReason is required' });
    }

    const expense = await Expense.findOne({ _id: id, ...branchFilter(req) });
    if (!expense) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    if (expense.status !== 'pending') {
      return res.status(400).json({ error: `Cannot reject expense with status: ${expense.status}` });
    }

    expense.status = 'rejected';
    expense.rejectionReason = rejectionReason;
    expense.statusHistory.push({
      status: 'rejected',
      changedBy: req.user.userId,
      notes: rejectionReason,
    });
    await expense.save();

    res.json(expense);
  } catch (error) {
    console.error('Error rejecting expense:', error);
    res.status(500).json({ error: 'Failed to reject expense' });
  }
};

export const updateExpense = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body, updatedAt: Date.now() };
    delete updates._id;
    delete updates.organizationId;
    delete updates.branchId;

    if (updates.categoryId) {
      const categoryDoc = await ExpenseCategory.findOne({ _id: updates.categoryId, organizationId: req.organizationId });
      if (!categoryDoc) {
        return res.status(400).json({ error: 'Invalid expense category' });
      }
      updates.category = categoryDoc.name;
    }

    const expense = await Expense.findOneAndUpdate(
      { _id: id, ...branchFilter(req) },
      updates,
      { new: true }
    ).populate('approvedBy', 'firstName lastName');

    if (!expense) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    // Keep the ledger entry in sync if this expense was already approved
    // (no-op if it wasn't — pending/rejected expenses have no Transaction yet)
    await Transaction.findOneAndUpdate(
      { relatedModel: 'Expense', relatedId: expense._id },
      {
        amount: expense.amount,
        paymentMethod: expense.paymentMethod,
        description: `${expense.category} expense${expense.vendor ? ` - ${expense.vendor}` : ''}`,
      }
    );

    res.json(expense);
  } catch (error) {
    console.error('Error updating expense:', error);
    res.status(500).json({ error: 'Failed to update expense' });
  }
};

export const deleteExpense = async (req, res) => {
  try {
    const { id } = req.params;
    const expense = await Expense.findOneAndDelete({ _id: id, ...branchFilter(req) });

    if (!expense) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    // Clean up the ledger entry too, otherwise a deleted (previously
    // approved) expense leaves an orphaned Transaction still counting toward totals.
    await Transaction.deleteOne({ relatedModel: 'Expense', relatedId: expense._id });

    res.json({ message: 'Expense deleted successfully' });
  } catch (error) {
    console.error('Error deleting expense:', error);
    res.status(500).json({ error: 'Failed to delete expense' });
  }
};

export const getExpenseStats = async (req, res) => {
  try {
    const stats = await Expense.aggregate([
      { $match: { ...branchFilter(req), status: 'approved' } },
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
  approveExpense,
  rejectExpense,
  updateExpense,
  deleteExpense,
  getExpenseStats,
};
