import PDFDocument from 'pdfkit';
import Donation from '../models/Donation.js';
import Expense from '../models/Expense.js';
import Transaction from '../models/Transaction.js';
import FinanceAccount from '../models/FinanceAccount.js';
import Organization from '../models/Organization.js';
import Branch from '../models/Branch.js';
import OfferingType from '../models/OfferingType.js';
import FundBucket from '../models/FundBucket.js';
import ExpenseCategory from '../models/ExpenseCategory.js';
import ProjectGroup from '../models/ProjectGroup.js';
import { branchFilter, resolveCreateBranch } from '../utils/branchQuery.js';
import cloudinary from '../config/cloudinary.js';
import { decrypt } from '../utils/encryption.js';
import { verifyBankAccount, createPaystackSubaccount } from '../services/paystackService.js';

export const getFinanceOverview = async (req, res) => {
  try {
    // Get total income from donations
    const incomeResult = await Donation.aggregate([
      { $match: branchFilter(req) },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const totalIncome = incomeResult[0]?.total || 0;

    // Get total expenses (approved only — pending/rejected aren't real outflow yet)
    const expenseResult = await Expense.aggregate([
      { $match: { ...branchFilter(req), status: 'approved' } },
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
      { $match: { ...branchFilter(req), status: 'approved', date: { $gte: sixMonthsAgo } } },
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
      { $match: { ...branchFilter(req), status: 'approved', date: { $gte: monthStart } } },
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
      { $match: { ...branchFilter(req), status: 'approved', date: { $gte: yearStart } } },
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

// Shared by getFinanceReport (JSON) and getFinanceReportPdf (PDF export)
async function fetchReportData(req, startDate, endDate) {
  const dateFilter = {};
  if (startDate) dateFilter.$gte = new Date(startDate);
  if (endDate) dateFilter.$lte = new Date(endDate);

  const donationFilter = startDate || endDate ? { ...branchFilter(req), donationDate: dateFilter } : { ...branchFilter(req) };
  const expenseFilter = startDate || endDate
    ? { ...branchFilter(req), status: 'approved', date: dateFilter }
    : { ...branchFilter(req), status: 'approved' };

  const [donations, expenses] = await Promise.all([
    Donation.find(donationFilter)
      .populate('donorId', 'firstName lastName')
      .populate('fundBucketId', 'name')
      .sort({ donationDate: -1 }),
    Expense.find(expenseFilter)
      .populate('approvedBy', 'firstName lastName')
      .populate('categoryId', 'name')
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

  // Expenses by category — group by the category's current name (via
  // categoryId) so a rename doesn't split history into two buckets; only
  // legacy expenses with no categoryId fall back to their frozen string.
  const expensesByCategory = {};
  expenses.forEach((e) => {
    const label = e.categoryId?.name || e.category;
    expensesByCategory[label] = (expensesByCategory[label] || 0) + e.amount;
  });

  return {
    totalIncome,
    totalExpenses,
    netBalance: totalIncome - totalExpenses,
    incomeByType,
    expensesByCategory,
    donations,
    expenses,
  };
}

export const getFinanceReport = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const report = await fetchReportData(req, startDate, endDate);
    res.json(report);
  } catch (error) {
    console.error('Error fetching finance report:', error);
    res.status(500).json({ error: 'Failed to fetch finance report' });
  }
};

export const getFinanceReportPdf = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const [report, org] = await Promise.all([
      fetchReportData(req, startDate, endDate),
      Organization.findById(req.organizationId).lean(),
    ]);

    const churchName = org?.churchName || 'Church';
    const currency = org?.currency || 'GHS';
    const periodLabel = startDate && endDate
      ? `${new Date(startDate).toLocaleDateString()} — ${new Date(endDate).toLocaleDateString()}`
      : 'All time';
    const fileName = `finance-report-${startDate || 'all'}-to-${endDate || 'all'}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    doc.pipe(res);

    // Letterhead
    doc.fontSize(18).font('Helvetica-Bold').text(churchName, { align: 'center' });
    doc.fontSize(14).font('Helvetica').text('Financial Report', { align: 'center' });
    doc.fontSize(10).fillColor('#666666').text(periodLabel, { align: 'center' });
    doc.fillColor('#000000');
    doc.moveDown(1);

    // Summary statement
    doc.fontSize(11).font('Helvetica-Bold').text('Summary');
    doc.font('Helvetica').fontSize(10);
    doc.text(`Total Income: ${currency} ${report.totalIncome.toFixed(2)}`);
    doc.text(`Total Expenses: ${currency} ${report.totalExpenses.toFixed(2)}`);
    doc.font('Helvetica-Bold').text(`Net Balance: ${currency} ${report.netBalance.toFixed(2)}`);
    doc.font('Helvetica');
    doc.moveDown(1);

    const drawBreakdownTable = (title, rows) => {
      doc.fontSize(11).font('Helvetica-Bold').text(title);
      doc.moveDown(0.3);

      const colWidths = [350, 130];
      const tableLeft = 40;
      const rowHeight = 20;
      let y = doc.y;

      const drawRow = (cells, isHeader) => {
        if (y + rowHeight > doc.page.height - 40) {
          doc.addPage({ size: 'A4', margin: 40 });
          y = 40;
        }
        doc.fontSize(9).font(isHeader ? 'Helvetica-Bold' : 'Helvetica');
        doc.rect(tableLeft, y, colWidths.reduce((a, b) => a + b, 0), rowHeight)
          .fill(isHeader ? '#f4f4f4' : '#ffffff')
          .stroke('#dddddd');
        doc.fillColor('#000000');
        let x = tableLeft + 5;
        cells.forEach((cell, i) => {
          doc.text(String(cell), x, y + 5, { width: colWidths[i] - 10, lineBreak: false });
          x += colWidths[i];
        });
        y += rowHeight;
      };

      drawRow(['Category', `Amount (${currency})`], true);
      Object.entries(rows).forEach(([label, amount]) => drawRow([label, amount.toFixed(2)], false));

      // Manual row drawing above leaves PDFKit's x cursor at the last cell's
      // column instead of the page margin — reset both before the next
      // untargeted .text() call (e.g. the next table's title) or it renders
      // offset to the right instead of starting a new line.
      doc.x = tableLeft;
      doc.y = y;
      doc.moveDown(1);
    };

    drawBreakdownTable('Income by Type', report.incomeByType);
    drawBreakdownTable('Expenses by Category', report.expensesByCategory);

    doc.end();
  } catch (error) {
    console.error('Error generating finance report PDF:', error);
    res.status(500).json({ error: 'Failed to generate finance report PDF' });
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
      branchId,
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
      bankAccountType,
    } = req.body;

    // Validate required fields
    const requiredFields = [
      'branchId',
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
      'bankAccountType',
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

    const branch = await Branch.findOne({ _id: branchId, organizationId });
    if (!branch) {
      return res.status(400).json({ error: 'Invalid branch for this organization' });
    }

    // Check if this branch already has a finance account (resubmission path)
    let financeAccount = await FinanceAccount.findOne({ organizationId, branchId });

    if (financeAccount) {
      // Only allow resubmission if rejected or revoked
      // Don't allow resubmit if already approved or currently pending review
      if (!['rejected', 'pending', 'revoked'].includes(financeAccount.status)) {
        return res.status(400).json({
          error: `Cannot resubmit. Current status: ${financeAccount.status}`,
        });
      }

      // If currently pending, don't allow resubmit (still waiting for approval)
      if (financeAccount.status === 'pending') {
        return res.status(400).json({
          error: 'Your submission is still pending approval. Please wait for a decision before resubmitting.',
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
      financeAccount.bankAccountType = bankAccountType;
      financeAccount.status = 'pending';
      financeAccount.submittedAt = Date.now();
      financeAccount.submittedBy = req.user._id;
      financeAccount.statusHistory.push({
        status: 'pending',
        changedBy: req.user._id,
        notes: 'Resubmitted after rejection',
      });
    } else {
      // Only one primary (full KYC) account per organization — other branches
      // must use the self-service subaccount path under Finance Settings.
      const existingPrimary = await FinanceAccount.exists({ organizationId, tier: 'primary' });
      if (existingPrimary) {
        return res.status(400).json({
          error: 'This organization already has a primary finance account. Set up additional branches from Finance Settings instead.',
        });
      }

      // Create new primary finance account
      financeAccount = new FinanceAccount({
        organizationId,
        branchId,
        tier: 'primary',
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
        bankAccountType,
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

    if (!req.branchId) {
      return res.json({
        status: 'no_branch_selected',
        message: 'Select a specific branch to access the finance module.',
      });
    }

    const financeAccount = await FinanceAccount.findOne({ organizationId, branchId: req.branchId })
      .select('-businessRegistrationDoc -ownerIdDoc -paystackSecretKey') // Don't return document URLs or secrets in status check
      .populate('submittedBy', 'firstName lastName email')
      .populate('approvedBy', 'firstName lastName email')
      .populate('revokedBy', 'firstName lastName email')
      .lean();

    if (!financeAccount) {
      const orgHasPrimary = await FinanceAccount.exists({ organizationId, tier: 'primary' });
      if (orgHasPrimary) {
        return res.json({
          status: 'no_branch_account',
          message: "This branch doesn't have a finance account yet. Set one up from Finance Settings.",
        });
      }
      return res.json({
        status: 'not_started',
        message: 'No finance account setup found. Please submit your merchant details to proceed.',
      });
    }

    // Return appropriate response based on status
    const response = {
      _id: financeAccount._id,
      status: financeAccount.status,
      tier: financeAccount.tier,
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

// ===== BRANCH FINANCE ACCOUNTS (primary + self-service subaccounts) =====

export const getBranchAccounts = async (req, res) => {
  try {
    const organizationId = req.organizationId;

    const [branches, accounts] = await Promise.all([
      Branch.find({ organizationId }).sort({ isHeadOffice: -1, name: 1 }).lean(),
      FinanceAccount.find({ organizationId })
        .select('-businessRegistrationDoc -ownerIdDoc -paystackSecretKey')
        .lean(),
    ]);

    const accountByBranch = new Map(accounts.map((a) => [String(a.branchId), a]));

    const result = branches.map((branch) => {
      const account = accountByBranch.get(String(branch._id));
      return {
        branchId: branch._id,
        branchName: branch.name,
        isHeadOffice: branch.isHeadOffice,
        hasAccount: !!account,
        tier: account?.tier || null,
        status: account?.status || 'none',
        paystackKeysConfigured: account?.tier === 'primary' ? !!account?.paystackKeysAddedAt : null,
      };
    });

    res.json(result);
  } catch (error) {
    console.error('Error fetching branch accounts:', error);
    res.status(500).json({ error: 'Failed to fetch branch accounts' });
  }
};

export const createBranchSubaccount = async (req, res) => {
  try {
    const { branchId } = req.params;
    const { bankCode, bankAccountName, bankAccountNumber } = req.body;

    if (!bankCode || !bankAccountName || !bankAccountNumber) {
      return res.status(400).json({ error: 'bankCode, bankAccountName, and bankAccountNumber are required' });
    }

    const organizationId = req.organizationId;

    const branch = await Branch.findOne({ _id: branchId, organizationId });
    if (!branch) {
      return res.status(404).json({ error: 'Branch not found' });
    }

    const existing = await FinanceAccount.findOne({ organizationId, branchId });
    if (existing) {
      return res.status(400).json({ error: 'This branch already has a finance account' });
    }

    const primary = await FinanceAccount.findOne({ organizationId, tier: 'primary', status: 'approved' });
    if (!primary || !primary.paystackSecretKey) {
      return res.status(400).json({
        error: "Your organization's primary account must be approved with Paystack keys configured before adding branch accounts",
      });
    }

    const primarySecretKey = decrypt(primary.paystackSecretKey);

    const bankVerification = await verifyBankAccount(bankCode, bankAccountNumber, primarySecretKey);
    if (!bankVerification.success) {
      return res.status(400).json({ error: bankVerification.error || 'Bank account verification failed' });
    }

    const subaccountResult = await createPaystackSubaccount({
      secretKey: primarySecretKey,
      businessName: `${branch.name} - ${primary.businessName}`,
      bankCode,
      accountNumber: bankAccountNumber,
    });

    if (!subaccountResult.success) {
      return res.status(400).json({ error: subaccountResult.error || 'Failed to create Paystack subaccount' });
    }

    const financeAccount = await FinanceAccount.create({
      organizationId,
      branchId,
      tier: 'subaccount',
      status: 'approved',
      paystackSubaccountCode: subaccountResult.paystackSubaccountCode,
      subaccountBankCode: bankCode,
      subaccountBankAccountName: bankAccountName,
      subaccountBankAccountNumber: bankAccountNumber,
      subaccountCreatedAt: Date.now(),
      subaccountCreatedBy: req.user._id,
      statusHistory: [
        {
          status: 'approved',
          changedBy: req.user._id,
          notes: `Subaccount created under primary account (${subaccountResult.paystackSubaccountCode})`,
        },
      ],
    });

    if (req.auditLog) {
      await req.auditLog.create({
        actor: req.user._id,
        action: 'branch_subaccount_created',
        targetType: 'FinanceAccount',
        targetId: financeAccount._id,
        organizationId,
        details: { branchId, paystackSubaccountCode: subaccountResult.paystackSubaccountCode },
      });
    }

    res.status(201).json(financeAccount);
  } catch (error) {
    console.error('Error creating branch subaccount:', error);
    res.status(500).json({ error: 'Failed to create branch subaccount' });
  }
};

// ===== OFFERING TYPES (dynamic, per-branch, merchant-defined) =====

export const getOfferingTypes = async (req, res) => {
  try {
    let offeringTypes = await OfferingType.find(branchFilter(req)).sort({ createdAt: 1 });

    if (offeringTypes.length === 0) {
      const branchId = resolveCreateBranch(req);
      if (!branchId) {
        return res.status(400).json({ error: 'Branch is required' });
      }
      const defaultType = await OfferingType.create({
        organizationId: req.organizationId,
        branchId,
        name: 'General',
        isDefault: true,
      });
      offeringTypes = [defaultType];
    }

    res.json(offeringTypes);
  } catch (error) {
    console.error('Error fetching offering types:', error);
    res.status(500).json({ error: 'Failed to fetch offering types' });
  }
};

export const createOfferingType = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const branchId = resolveCreateBranch(req);
    if (!branchId) {
      return res.status(400).json({ error: 'Branch is required' });
    }

    const offeringType = await OfferingType.create({
      organizationId: req.organizationId,
      branchId,
      name: name.trim(),
    });

    res.status(201).json(offeringType);
  } catch (error) {
    console.error('Error creating offering type:', error.message, error.stack);
    res.status(500).json({
      error: 'Failed to create offering type',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

export const updateOfferingType = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, enabled } = req.body;

    const offeringType = await OfferingType.findOne({ _id: id, ...branchFilter(req) });
    if (!offeringType) {
      return res.status(404).json({ error: 'Offering type not found' });
    }

    if (enabled === false && offeringType.enabled) {
      const otherEnabledCount = await OfferingType.countDocuments({
        ...branchFilter(req),
        _id: { $ne: id },
        enabled: true,
      });
      if (otherEnabledCount === 0) {
        return res.status(400).json({ error: 'Cannot disable the only active offering type' });
      }
    }

    if (name !== undefined) offeringType.name = name.trim();
    if (enabled !== undefined) offeringType.enabled = enabled;
    await offeringType.save();

    res.json(offeringType);
  } catch (error) {
    console.error('Error updating offering type:', error);
    res.status(500).json({ error: 'Failed to update offering type' });
  }
};

export const deleteOfferingType = async (req, res) => {
  try {
    const { id } = req.params;

    const offeringType = await OfferingType.findOne({ _id: id, ...branchFilter(req) });
    if (!offeringType) {
      return res.status(404).json({ error: 'Offering type not found' });
    }

    const hasDonations = await Donation.exists({ offeringTypeId: id });
    if (hasDonations) {
      return res.status(400).json({
        error: 'Cannot delete a type that already has recorded offerings. Disable it instead.',
      });
    }

    await OfferingType.deleteOne({ _id: id });

    res.json({ message: 'Offering type deleted' });
  } catch (error) {
    console.error('Error deleting offering type:', error);
    res.status(500).json({ error: 'Failed to delete offering type' });
  }
};

// ===== EXPENSE CATEGORIES (dynamic, per-branch, merchant-defined) =====

const DEFAULT_EXPENSE_CATEGORIES = ['utilities', 'salaries', 'maintenance', 'supplies', 'transport', 'events', 'other'];

export const getExpenseCategories = async (req, res) => {
  try {
    let categories = await ExpenseCategory.find(branchFilter(req)).sort({ createdAt: 1 });

    if (categories.length === 0) {
      const branchId = resolveCreateBranch(req);
      if (!branchId) {
        return res.status(400).json({ error: 'Branch is required' });
      }
      categories = await ExpenseCategory.insertMany(
        DEFAULT_EXPENSE_CATEGORIES.map((name) => ({
          organizationId: req.organizationId,
          branchId,
          name: name.charAt(0).toUpperCase() + name.slice(1),
          isDefault: name === 'other',
        }))
      );
    }

    res.json(categories);
  } catch (error) {
    console.error('Error fetching expense categories:', error);
    res.status(500).json({ error: 'Failed to fetch expense categories' });
  }
};

export const createExpenseCategory = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const branchId = resolveCreateBranch(req);
    if (!branchId) {
      return res.status(400).json({ error: 'Branch is required' });
    }

    const category = await ExpenseCategory.create({
      organizationId: req.organizationId,
      branchId,
      name: name.trim(),
    });

    res.status(201).json(category);
  } catch (error) {
    console.error('Error creating expense category:', error.message, error.stack);
    res.status(500).json({
      error: 'Failed to create expense category',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

export const updateExpenseCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, enabled } = req.body;

    const category = await ExpenseCategory.findOne({ _id: id, ...branchFilter(req) });
    if (!category) {
      return res.status(404).json({ error: 'Expense category not found' });
    }

    if (enabled === false && category.enabled) {
      const otherEnabledCount = await ExpenseCategory.countDocuments({
        ...branchFilter(req),
        _id: { $ne: id },
        enabled: true,
      });
      if (otherEnabledCount === 0) {
        return res.status(400).json({ error: 'Cannot disable the only active expense category' });
      }
    }

    if (name !== undefined) category.name = name.trim();
    if (enabled !== undefined) category.enabled = enabled;
    await category.save();

    res.json(category);
  } catch (error) {
    console.error('Error updating expense category:', error);
    res.status(500).json({ error: 'Failed to update expense category' });
  }
};

export const deleteExpenseCategory = async (req, res) => {
  try {
    const { id } = req.params;

    const category = await ExpenseCategory.findOne({ _id: id, ...branchFilter(req) });
    if (!category) {
      return res.status(404).json({ error: 'Expense category not found' });
    }

    const hasExpenses = await Expense.exists({ categoryId: id });
    if (hasExpenses) {
      return res.status(400).json({
        error: 'Cannot delete a category that already has recorded expenses. Disable it instead.',
      });
    }

    await ExpenseCategory.deleteOne({ _id: id });

    res.json({ message: 'Expense category deleted' });
  } catch (error) {
    console.error('Error deleting expense category:', error);
    res.status(500).json({ error: 'Failed to delete expense category' });
  }
};

// ===== PROJECTS (mission/building/other funds with a fundraising goal) =====

export const getProjects = async (req, res) => {
  try {
    const filter = branchFilter(req);
    // Include legacy org-wide (branchId: null) buckets alongside branch-scoped ones
    if (filter.branchId) {
      filter.$or = [{ branchId: filter.branchId }, { branchId: null }];
      delete filter.branchId;
    }

    const projects = await FundBucket.find(filter).populate('groupId', 'name').sort({ createdAt: -1 }).lean();
    const projectIds = projects.map((p) => p._id);

    const raised = await Donation.aggregate([
      { $match: { fundBucketId: { $in: projectIds }, donationType: 'project' } },
      { $group: { _id: '$fundBucketId', raisedAmount: { $sum: '$amount' }, donationCount: { $sum: 1 } } },
    ]);
    const raisedById = new Map(raised.map((r) => [String(r._id), r]));

    const result = projects.map((p) => ({
      ...p,
      raisedAmount: raisedById.get(String(p._id))?.raisedAmount || 0,
      donationCount: raisedById.get(String(p._id))?.donationCount || 0,
    }));

    res.json(result);
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
};

export const createProject = async (req, res) => {
  try {
    const { name, description, targetAmount, targetDate, groupId } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const branchId = resolveCreateBranch(req);
    if (!branchId) {
      return res.status(400).json({ error: 'Branch is required' });
    }

    const project = await FundBucket.create({
      organizationId: req.organizationId,
      branchId,
      name: name.trim(),
      description,
      targetAmount: targetAmount || null,
      targetDate: targetDate || null,
      groupId: groupId || null,
    });

    res.status(201).json(project);
  } catch (error) {
    console.error('Error creating project:', error.message, error.stack);
    res.status(500).json({
      error: 'Failed to create project',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

export const updateProject = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, targetAmount, targetDate, status, enabled, groupId } = req.body;

    const filter = branchFilter(req);
    if (filter.branchId) {
      filter.$or = [{ branchId: filter.branchId }, { branchId: null }];
      delete filter.branchId;
    }

    const project = await FundBucket.findOne({ _id: id, ...filter });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (name !== undefined) project.name = name.trim();
    if (description !== undefined) project.description = description;
    if (targetAmount !== undefined) project.targetAmount = targetAmount || null;
    if (targetDate !== undefined) project.targetDate = targetDate || null;
    if (status !== undefined) project.status = status;
    if (enabled !== undefined) project.enabled = enabled;
    if (groupId !== undefined) project.groupId = groupId || null;
    await project.save();

    res.json(project);
  } catch (error) {
    console.error('Error updating project:', error);
    res.status(500).json({ error: 'Failed to update project' });
  }
};

// ===== PROJECT GROUPS (dynamic, per-branch, merchant-defined categories) =====

export const getProjectGroups = async (req, res) => {
  try {
    let groups = await ProjectGroup.find(branchFilter(req)).sort({ createdAt: 1 });

    if (groups.length === 0) {
      const branchId = resolveCreateBranch(req);
      if (!branchId) {
        return res.status(400).json({ error: 'Branch is required' });
      }
      const defaultGroup = await ProjectGroup.create({
        organizationId: req.organizationId,
        branchId,
        name: 'General',
        isDefault: true,
      });
      groups = [defaultGroup];
    }

    res.json(groups);
  } catch (error) {
    console.error('Error fetching project groups:', error);
    res.status(500).json({ error: 'Failed to fetch project groups' });
  }
};

export const createProjectGroup = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const branchId = resolveCreateBranch(req);
    if (!branchId) {
      return res.status(400).json({ error: 'Branch is required' });
    }

    const group = await ProjectGroup.create({
      organizationId: req.organizationId,
      branchId,
      name: name.trim(),
    });

    res.status(201).json(group);
  } catch (error) {
    console.error('Error creating project group:', error.message, error.stack);
    res.status(500).json({
      error: 'Failed to create project group',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

export const updateProjectGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, enabled } = req.body;

    const group = await ProjectGroup.findOne({ _id: id, ...branchFilter(req) });
    if (!group) {
      return res.status(404).json({ error: 'Project group not found' });
    }

    if (enabled === false && group.enabled) {
      const otherEnabledCount = await ProjectGroup.countDocuments({
        ...branchFilter(req),
        _id: { $ne: id },
        enabled: true,
      });
      if (otherEnabledCount === 0) {
        return res.status(400).json({ error: 'Cannot disable the only active project group' });
      }
    }

    if (name !== undefined) group.name = name.trim();
    if (enabled !== undefined) group.enabled = enabled;
    await group.save();

    res.json(group);
  } catch (error) {
    console.error('Error updating project group:', error);
    res.status(500).json({ error: 'Failed to update project group' });
  }
};

export const deleteProjectGroup = async (req, res) => {
  try {
    const { id } = req.params;

    const group = await ProjectGroup.findOne({ _id: id, ...branchFilter(req) });
    if (!group) {
      return res.status(404).json({ error: 'Project group not found' });
    }

    const hasProjects = await FundBucket.exists({ groupId: id });
    if (hasProjects) {
      return res.status(400).json({
        error: 'Cannot delete a group that already has projects assigned. Disable it instead.',
      });
    }

    await ProjectGroup.deleteOne({ _id: id });

    res.json({ message: 'Project group deleted' });
  } catch (error) {
    console.error('Error deleting project group:', error);
    res.status(500).json({ error: 'Failed to delete project group' });
  }
};

export default {
  getFinanceOverview,
  getFinanceReport,
  getFinanceReportPdf,
  getTransactions,
  getTransactionSummary,
  getTransactionById,
  submitFinanceAccount,
  getFinanceAccountStatus,
  getBankList,
  getBranchAccounts,
  createBranchSubaccount,
  getOfferingTypes,
  createOfferingType,
  updateOfferingType,
  deleteOfferingType,
  getExpenseCategories,
  createExpenseCategory,
  updateExpenseCategory,
  deleteExpenseCategory,
  getProjects,
  createProject,
  updateProject,
  getProjectGroups,
  createProjectGroup,
  updateProjectGroup,
  deleteProjectGroup,
};
