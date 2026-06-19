import Donation from '../models/Donation.js';
import Expense from '../models/Expense.js';
import Transaction from '../models/Transaction.js';
import FinanceAccount from '../models/FinanceAccount.js';
import Organization from '../models/Organization.js';
import { branchFilter, resolveCreateBranch } from '../utils/branchQuery.js';
import cloudinary from '../config/cloudinary.js';

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

// ===== FINANCE ACCOUNT SUBMISSION & STATUS =====

export const submitFinanceAccount = async (req, res) => {
  try {
    const {
      businessName,
      businessType,
      businessRegistration,
      businessAddress,
      ownerFullName,
      ownerEmail,
      ownerPhone,
      ownerIdType,
      ownerIdNumber,
      bankCode,
      bankAccountName,
      bankAccountNumber,
      accountType,
    } = req.body;

    // Validate required fields
    const requiredFields = [
      'businessName',
      'businessType',
      'businessRegistration',
      'businessAddress',
      'ownerFullName',
      'ownerEmail',
      'ownerPhone',
      'ownerIdType',
      'ownerIdNumber',
      'bankCode',
      'bankAccountName',
      'bankAccountNumber',
      'accountType',
    ];

    for (const field of requiredFields) {
      if (!req.body[field]) {
        return res.status(400).json({ error: `${field} is required` });
      }
    }

    // Validate uploaded files (business registration and owner ID only)
    if (!req.files || !req.files.businessRegistrationDoc || !req.files.ownerIdDoc) {
      return res.status(400).json({ error: 'Business registration and owner ID documents are required' });
    }

    let businessRegistrationDocUrl, ownerIdDocUrl;

    try {
      // Upload businessRegistrationDoc to Cloudinary
      businessRegistrationDocUrl = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { resource_type: 'auto', folder: 'sanctuary_connect/kyc/business_registration' },
          (error, result) => {
            if (error) {
              console.error('Cloudinary upload error for businessRegistrationDoc:', error);
              reject(error);
            } else {
              console.log('Successfully uploaded businessRegistrationDoc:', result.secure_url);
              resolve(result.secure_url);
            }
          }
        );
        stream.end(req.files.businessRegistrationDoc[0].buffer);
      });

      // Upload ownerIdDoc to Cloudinary
      ownerIdDocUrl = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { resource_type: 'auto', folder: 'sanctuary_connect/kyc/owner_id' },
          (error, result) => {
            if (error) {
              console.error('Cloudinary upload error for ownerIdDoc:', error);
              reject(error);
            } else {
              console.log('Successfully uploaded ownerIdDoc:', result.secure_url);
              resolve(result.secure_url);
            }
          }
        );
        stream.end(req.files.ownerIdDoc[0].buffer);
      });
    } catch (uploadError) {
      console.error('Error uploading documents to Cloudinary:', uploadError);
      return res.status(500).json({
        error: 'Failed to upload documents',
        details: uploadError instanceof Error ? uploadError.message : 'Unknown error'
      });
    }

    const organizationId = req.organizationId;

    // Check if finance account already exists for this organization
    let financeAccount = await FinanceAccount.findOne({ organizationId });

    if (financeAccount) {
      // Only allow update if status is rejected or revoked
      if (!['rejected', 'revoked'].includes(financeAccount.status)) {
        return res.status(400).json({
          error: `Cannot resubmit. Current status: ${financeAccount.status}`,
        });
      }
      // Update existing document
      financeAccount.businessName = businessName;
      financeAccount.businessType = businessType;
      financeAccount.businessRegistration = businessRegistration;
      financeAccount.businessRegistrationDoc = businessRegistrationDocUrl;
      financeAccount.businessAddress = businessAddress;
      financeAccount.ownerFullName = ownerFullName;
      financeAccount.ownerEmail = ownerEmail;
      financeAccount.ownerPhone = ownerPhone;
      financeAccount.ownerIdType = ownerIdType;
      financeAccount.ownerIdNumber = ownerIdNumber;
      financeAccount.ownerIdDoc = ownerIdDocUrl;
      financeAccount.bankCode = bankCode;
      financeAccount.bankAccountName = bankAccountName;
      financeAccount.bankAccountNumber = bankAccountNumber;
      financeAccount.accountType = accountType;
      financeAccount.status = 'pending';
      financeAccount.submittedAt = Date.now();
      financeAccount.submittedBy = req.user._id;
      financeAccount.statusHistory.push({
        status: 'pending',
        changedBy: req.user._id,
        notes: 'Resubmitted after rejection',
      });
    } else {
      // Create new finance account
      financeAccount = new FinanceAccount({
        organizationId,
        businessName,
        businessType,
        businessRegistration,
        businessRegistrationDoc: businessRegistrationDocUrl,
        businessAddress,
        ownerFullName,
        ownerEmail,
        ownerPhone,
        ownerIdType,
        ownerIdNumber,
        ownerIdDoc: ownerIdDocUrl,
        bankCode,
        bankAccountName,
        bankAccountNumber,
        accountType,
        submittedBy: req.user._id,
        statusHistory: [
          {
            status: 'pending',
            changedBy: req.user._id,
            notes: 'Initial submission',
          },
        ],
      });
    }

    await financeAccount.save();

    console.log('Finance account saved successfully:', {
      id: financeAccount._id,
      businessRegistrationDocUrl,
      ownerIdDocUrl,
      status: financeAccount.status
    });

    // Update organization's financeAccountId if not already set
    await Organization.updateOne(
      { _id: organizationId, financeAccountId: { $exists: false } },
      { $set: { financeAccountId: financeAccount._id } }
    );

    // Log to audit log if available
    if (req.auditLog) {
      await req.auditLog.create({
        actor: req.user._id,
        action: 'finance_account_submitted',
        targetType: 'FinanceAccount',
        targetId: financeAccount._id,
        organizationId,
        details: { status: 'pending' },
      });
    }

    res.status(201).json({
      message: 'Finance account submitted successfully. Awaiting superadmin approval.',
      financeAccount: {
        _id: financeAccount._id,
        status: financeAccount.status,
        submittedAt: financeAccount.submittedAt,
        businessName: financeAccount.businessName,
      },
    });
  } catch (error) {
    console.error('Error submitting finance account:', error);
    res.status(500).json({ error: 'Failed to submit finance account' });
  }
};

export const getFinanceAccountStatus = async (req, res) => {
  try {
    const organizationId = req.organizationId;

    const financeAccount = await FinanceAccount.findOne({ organizationId })
      .select('-businessRegistrationDoc -taxIdDoc -ownerIdDoc') // Don't return document URLs in status check
      .populate('submittedBy', 'firstName lastName email')
      .populate('approvedBy', 'firstName lastName email')
      .populate('revokedBy', 'firstName lastName email')
      .lean();

    if (!financeAccount) {
      return res.json({
        status: 'not_started',
        message: 'No finance account setup found. Please submit your merchant details to proceed.',
      });
    }

    // Return appropriate response based on status
    const response = {
      _id: financeAccount._id,
      status: financeAccount.status,
      submittedAt: financeAccount.submittedAt,
      businessName: financeAccount.businessName,
      ownerFullName: financeAccount.ownerFullName,
    };

    if (financeAccount.status === 'pending') {
      response.message = 'Your submission is pending superadmin approval.';
    } else if (financeAccount.status === 'approved') {
      response.message = 'Your finance account is approved. You now have access to the finance module.';
      response.approvedAt = financeAccount.approvedAt;
      response.approvedBy = financeAccount.approvedBy;
    } else if (financeAccount.status === 'rejected') {
      response.message = `Your submission was rejected. Reason: ${financeAccount.rejectionReason}`;
      response.rejectionReason = financeAccount.rejectionReason;
      response.rejectionDetails = financeAccount.rejectionDetails;
    } else if (financeAccount.status === 'revoked') {
      response.message = `Your finance account has been revoked. Reason: ${financeAccount.revokedReason}`;
      response.revokedReason = financeAccount.revokedReason;
      response.revokedAt = financeAccount.revokedAt;
    }

    res.json(response);
  } catch (error) {
    console.error('Error fetching finance account status:', error);
    res.status(500).json({ error: 'Failed to fetch finance account status' });
  }
};

export const getBankList = async (req, res) => {
  try {
    // Comprehensive list of Ghanaian banks (with Paystack bank codes)
    const ghanaianBanks = [
      // Major Banks
      { code: '011', name: 'Guaranty Trust Bank Ghana' },
      { code: '012', name: 'Ecobank Ghana' },
      { code: '013', name: 'Barclays Bank Ghana' },
      { code: '014', name: 'Zenith Bank Ghana' },
      { code: '015', name: 'Société Générale Ghana' },
      { code: '018', name: 'Access Bank Ghana' },
      { code: '019', name: 'Stanbic Bank Ghana' },
      { code: '020', name: 'Calbank Ghana' },
      { code: '021', name: 'Prudential Bank Ghana' },
      { code: '022', name: 'First National Bank Ghana' },
      { code: '023', name: 'Metropolitan Bank Ghana' },
      { code: '024', name: 'GCB Bank Ghana' },
      { code: '025', name: 'Agriculture Development Bank' },
      { code: '026', name: 'Absa Bank Ghana' },
      { code: '027', name: 'ICBC Ghana' },
      { code: '030', name: 'United Bank for Africa Ghana' },
      { code: '031', name: 'The Delf Bank Ghana' },
      { code: '032', name: 'Fidelity Bank Ghana' },
      { code: '033', name: 'Habib Ghana Bank' },
      { code: '034', name: 'Mega Bank Ghana' },
      { code: '035', name: 'Heritage Bank Ghana' },
      { code: '036', name: 'Vertex Bank Ghana' },
      { code: '037', name: 'Infinity Bank Ghana' },

      // Savings & Loans (Non-Bank Financial Institutions)
      { code: '038', name: 'OmniBSIC Ghana' },
      { code: '039', name: 'Cashlink Ghana' },
      { code: '040', name: 'Ghana Savings and Loans' },
      { code: '041', name: 'UniCredit Ghana' },
      { code: '042', name: 'Ark Foundation Savings and Loans' },
      { code: '043', name: 'Advances Finance Limited' },
      { code: '044', name: 'Midland Savings and Loans' },
      { code: '045', name: 'Legacy Bank Ghana' },
      { code: '046', name: 'Sinapi Aba Savings and Loans' },
      { code: '047', name: 'Adeny Savings and Loans' },
      { code: '048', name: 'First Capital Plus Bank' },
      { code: '049', name: 'Community Savings and Loans' },
      { code: '050', name: 'Speedex Money Ghana' },
      { code: '051', name: 'Intercredit Bank Ghana' },
      { code: '052', name: 'Consolidated Bank Ghana' },

      // Mobile Money & Digital
      { code: '053', name: 'MTN Ghana (Mobile Money)' },
      { code: '054', name: 'Vodafone Ghana (Mobile Money)' },
      { code: '055', name: 'AirtelTigo Ghana (Mobile Money)' },
    ];

    res.json({ banks: ghanaianBanks });
  } catch (error) {
    console.error('Error fetching bank list:', error);
    res.status(500).json({ error: 'Failed to fetch bank list' });
  }
};

export default {
  getFinanceOverview,
  getFinanceReport,
  getTransactions,
  getTransactionSummary,
  getTransactionById,
  submitFinanceAccount,
  getFinanceAccountStatus,
  getBankList,
};
