import smsService from '../services/smsService.js';
import SmsCredit from '../models/SmsCredit.js';
import SmsPayment from '../models/SmsPayment.js';
import SmsLog from '../models/SmsLog.js';
import Member from '../models/Member.js';
import Department from '../models/Department.js';
import Branch from '../models/Branch.js';
import Organization from '../models/Organization.js';
import { checkSmsCredits } from '../utils/usageLimits.js';
import axios from 'axios';

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PRICE_PER_CREDIT = 0.035; // GHS

// Get SMS credits balance
export const getCreditsBalance = async (req, res) => {
  try {
    const merchantId = req.user.organizationId;
    
    const smsCredit = await SmsCredit.getOrCreate(merchantId, 0);
    
    res.json({
      balance: smsCredit.balance,
      totalPurchased: smsCredit.totalPurchased,
      totalUsed: smsCredit.totalUsed,
      lastPurchase: smsCredit.lastPurchase,
      autoRecharge: smsCredit.autoRecharge
    });
  } catch (error) {
    console.error('Get credits balance error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Get credit transactions history
export const getCreditTransactions = async (req, res) => {
  try {
    const merchantId = req.user.organizationId;
    const { page = 1, limit = 20 } = req.query;
    
    const smsCredit = await SmsCredit.findOne({ merchantId });
    
    if (!smsCredit) {
      return res.json({
        transactions: [],
        pagination: { page: 1, limit: 20, total: 0, pages: 0 }
      });
    }

    const transactions = smsCredit.transactions
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice((page - 1) * limit, page * limit);

    res.json({
      transactions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: smsCredit.transactions.length,
        pages: Math.ceil(smsCredit.transactions.length / limit)
      }
    });
  } catch (error) {
    console.error('Get credit transactions error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Purchase SMS credits
export const purchaseCredits = async (req, res) => {
  try {
    const merchantId = req.user.organizationId;
    const { amount, transactionId, paymentMethod } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid credit amount' });
    }

    const smsCredit = await SmsCredit.getOrCreate(merchantId, 0);
    
    await smsCredit.addCredits(
      amount,
      'purchase',
      `Credits purchased via ${paymentMethod || 'payment'}`,
      transactionId
    );

    res.json({
      success: true,
      message: `Successfully added ${amount} SMS credits`,
      balance: smsCredit.balance
    });
  } catch (error) {
    console.error('Purchase credits error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Initialize SMS credit purchase (calculate cost & create payment record)
export const initializeSmsPayment = async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { credits } = req.body;

    if (!credits || credits <= 0) {
      return res.status(400).json({ error: 'Invalid credit amount' });
    }

    const amountInGhs = credits * PRICE_PER_CREDIT;

    // Create payment record
    const payment = new SmsPayment({
      organizationId,
      credits,
      amountInGhs,
      status: 'pending',
      paymentMethod: 'card',
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    await payment.save();

    res.json({
      success: true,
      reference: payment._id,
      credits,
      pricePerCredit: PRICE_PER_CREDIT,
      subtotal: amountInGhs,
      tax: 0,
      total: amountInGhs,
      currency: 'GHS',
      message: `Ready to purchase ${credits} SMS credits for GHS ${amountInGhs.toFixed(2)}`
    });
  } catch (error) {
    console.error('Initialize SMS payment error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Verify SMS credit payment with Paystack
export const verifySmsPayment = async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { paystackReference } = req.body;

    if (!paystackReference) {
      return res.status(400).json({ error: 'Paystack reference is required' });
    }

    // Verify with Paystack
    const paystackResponse = await axios.get(
      `https://api.paystack.co/transaction/verify/${paystackReference}`,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`
        }
      }
    );

    const { data } = paystackResponse.data;

    if (!data) {
      return res.status(400).json({ error: 'Transaction not found on Paystack' });
    }

    if (data.status !== 'success') {
      return res.status(400).json({ 
        error: 'Payment was not successful',
        paystackStatus: data.status 
      });
    }

    // Find or create payment record
    let payment = await SmsPayment.findOne({ paystackReference });

    if (!payment) {
      // Calculate expected amount from Paystack data (in pesewas, so divide by 100)
      const amountInGhs = data.amount / 100;
      const credits = Math.round(amountInGhs / PRICE_PER_CREDIT);

      payment = new SmsPayment({
        organizationId,
        credits,
        amountInGhs,
        paystackReference,
        status: 'verified',
        paymentMethod: data.channel,
        channel: data.channel
      });
    } else if (payment.organizationId.toString() !== organizationId.toString()) {
      // Prevent one organization from using another's payment
      return res.status(403).json({ error: 'Payment does not belong to your organization' });
    } else {
      payment.status = 'verified';
      payment.paymentMethod = data.channel;
      payment.channel = data.channel;
    }

    // Store Paystack verification details
    payment.paystackVerification = {
      status: data.status,
      amount: data.amount / 100, // Convert from pesewas to GHS
      paidAt: new Date(data.paid_at),
      customerCode: data.customer?.customer_code,
      last4: data.authorization?.last4,
      brand: data.authorization?.brand,
      momoProvider: data.authorization?.bank || null,
      momoNumber: data.authorization?.exp_month ? `${data.authorization?.exp_month}/${data.authorization?.exp_year}` : null
    };

    payment.paystackCustomerCode = data.customer?.customer_code;
    payment.verifiedAt = new Date();

    await payment.save();

    // Credit the merchant's SMS account
    const smsCredit = await SmsCredit.getOrCreate(organizationId, 0);
    await smsCredit.addCredits(
      payment.credits,
      'purchase',
      `SMS credits purchased via Paystack (${data.channel})`,
      paystackReference
    );

    // Mark payment as completed
    payment.status = 'completed';
    payment.completedAt = new Date();
    await payment.save();

    res.json({
      success: true,
      message: `Successfully purchased ${payment.credits} SMS credits`,
      credits: payment.credits,
      amount: payment.amountInGhs,
      newBalance: smsCredit.balance,
      paystackReference
    });
  } catch (error) {
    console.error('Verify SMS payment error:', error);

    // Update payment record with error
    if (error.response?.status === 400) {
      const ref = error.config?.url?.split('/').pop();
      if (ref) {
        await SmsPayment.updateOne(
          { paystackReference: ref },
          { 
            status: 'failed',
            errorMessage: error.response.data?.message || error.message 
          }
        );
      }
    }

    res.status(500).json({ 
      error: error.response?.data?.message || error.message 
    });
  }
};

// Send single SMS
export const sendSingleSMS = async (req, res) => {
  try {
    const merchantId = req.user.organizationId;
    const userId = req.user.userId;
    const { phone, message, category, metadata } = req.body;
    if (!merchantId) {
      return res.status(400).json({ error: 'User organization not found. Please ensure your account is properly configured.' });
    }
    if (!phone || !message) {
      return res.status(400).json({ error: 'Phone number and message are required' });
    }

    // Check SMS credits
    const creditCheck = await checkSmsCredits(merchantId, 1);
    if (!creditCheck.allowed) {
      return res.status(403).json({
        error: `Insufficient SMS credits. You need ${creditCheck.required} credit(s) but only have ${creditCheck.currentBalance}`,
        code: 'INSUFFICIENT_SMS_CREDITS',
        currentBalance: creditCheck.currentBalance,
        required: creditCheck.required,
        shortfall: creditCheck.shortfall,
      });
    }

    const result = await smsService.sendSingle({
      phone,
      message,
      merchantId,
      userId,
      category: category || 'general',
      metadata: metadata || {}
    });

    res.json({
      success: result.success,
      message: result.success ? 'SMS sent successfully' : 'Failed to send SMS',
      smsLogId: result.smsLog._id,
      creditsUsed: result.creditsUsed,
      status: result.status
    });
  } catch (error) {
    console.error('Send single SMS error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Send bulk SMS
export const sendBulkSMS = async (req, res) => {
  try {
    const merchantId = req.user.organizationId;
    const userId = req.user.userId;
    const { phones, message, category, metadata } = req.body;

    if (!merchantId) {
      return res.status(400).json({ error: 'User organization not found. Please ensure your account is properly configured.' });
    }

    if (!phones || !Array.isArray(phones) || phones.length === 0) {
      return res.status(400).json({ error: 'Valid phone numbers array is required' });
    }

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Check SMS credits
    const creditCheck = await checkSmsCredits(merchantId, phones.length);
    if (!creditCheck.allowed) {
      return res.status(403).json({
        error: `Insufficient SMS credits. You need ${creditCheck.required} credit(s) but only have ${creditCheck.currentBalance}`,
        code: 'INSUFFICIENT_SMS_CREDITS',
        currentBalance: creditCheck.currentBalance,
        required: creditCheck.required,
        shortfall: creditCheck.shortfall,
        recipientCount: phones.length,
      });
    }

    const result = await smsService.sendBulk({
      phones,
      message,
      merchantId,
      userId,
      category: category || 'general',
      metadata: metadata || {}
    });

    res.json({
      success: result.success,
      message: `SMS sent to ${result.successCount} of ${result.recipientCount} recipients`,
      smsLogId: result.smsLog._id,
      recipientCount: result.recipientCount,
      successCount: result.successCount,
      failCount: result.failCount,
      creditsUsed: result.creditsUsed,
      status: result.status
    });
  } catch (error) {
    console.error('Send bulk SMS error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Send to selected members
export const sendToMembers = async (req, res) => {
  try {
    const merchantId = req.user.organizationId;
    const userId = req.user.userId;
    const { memberIds, message, category } = req.body;

    console.log('📤 [sendToMembers] MerchantId:', merchantId);
    console.log('📤 [sendToMembers] MemberIds:', memberIds);
    console.log('📤 [sendToMembers] Category:', category);

    if (!merchantId) {
      return res.status(400).json({ error: 'User organization not found. Please ensure your account is properly configured.' });
    }

    if (!memberIds || !Array.isArray(memberIds) || memberIds.length === 0) {
      return res.status(400).json({ error: 'Valid member IDs array is required' });
    }

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Check SMS credits
    const creditCheck = await checkSmsCredits(merchantId, memberIds.length);
    if (!creditCheck.allowed) {
      return res.status(403).json({
        error: `Insufficient SMS credits. You need ${creditCheck.required} credit(s) but only have ${creditCheck.currentBalance}`,
        code: 'INSUFFICIENT_SMS_CREDITS',
        currentBalance: creditCheck.currentBalance,
        required: creditCheck.required,
        shortfall: creditCheck.shortfall,
        recipientCount: memberIds.length,
      });
    }

    const result = await smsService.sendToMembers({
      memberIds,
      message,
      merchantId,
      userId,
      category: category || 'general',
      branchId: req.user.currentBranch
    });

    console.log('✅ [sendToMembers] Result:', {
      success: result.success,
      successCount: result.successCount,
      failCount: result.failCount,
      resultsLength: result.results?.length
    });

    // Extract SMS log IDs from results
    const smsLogIds = result.results
      ?.filter(r => r.success && r.smsLog)
      .map(r => r.smsLog._id) || [];

    console.log('📋 [sendToMembers] Created SMS log IDs:', smsLogIds);

    res.json({
      success: result.success,
      message: `SMS sent to ${result.successCount} of ${result.recipientCount} members`,
      recipientCount: result.recipientCount,
      successCount: result.successCount,
      failCount: result.failCount,
      creditsUsed: result.creditsUsed,
      smsLogIds: smsLogIds // Include log IDs for frontend tracking
    });
  } catch (error) {
    console.error('Send to members error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Send to branch
export const sendToBranch = async (req, res) => {
  try {
    const merchantId = req.user.organizationId;
    const userId = req.user.userId;
    const { branchId, message, category } = req.body;

    if (!merchantId) {
      return res.status(400).json({ error: 'User organization not found. Please ensure your account is properly configured.' });
    }

    if (!branchId) {
      return res.status(400).json({ error: 'Branch ID is required' });
    }

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Count branch members
    const memberCount = await Member.countDocuments({
      branch: branchId,
      phoneNumber: { $exists: true, $ne: '' }
    });

    // Check SMS credits
    const creditCheck = await checkSmsCredits(merchantId, memberCount);
    if (!creditCheck.allowed) {
      return res.status(403).json({
        error: `Insufficient SMS credits. You need ${creditCheck.required} credit(s) but only have ${creditCheck.currentBalance}`,
        code: 'INSUFFICIENT_SMS_CREDITS',
        currentBalance: creditCheck.currentBalance,
        required: creditCheck.required,
        shortfall: creditCheck.shortfall,
        recipientCount: memberCount,
      });
    }

    const result = await smsService.sendToBranch({
      branchId,
      message,
      merchantId,
      userId,
      category: category || 'general'
    });

    res.json({
      success: result.success,
      message: `SMS sent to ${result.successCount} of ${result.recipientCount} branch members`,
      smsLogId: result.smsLog._id,
      recipientCount: result.recipientCount,
      successCount: result.successCount,
      failCount: result.failCount,
      creditsUsed: result.creditsUsed
    });
  } catch (error) {
    console.error('Send to branch error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Send to department
export const sendToDepartment = async (req, res) => {
  try {
    const merchantId = req.user.organizationId;
    const userId = req.user.userId;
    const { departmentId, message, category } = req.body;

    if (!merchantId) {
      return res.status(400).json({ error: 'User organization not found. Please ensure your account is properly configured.' });
    }

    if (!departmentId) {
      return res.status(400).json({ error: 'Department ID is required' });
    }

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Count department members
    const memberCount = await Member.countDocuments({
      department: departmentId,
      phoneNumber: { $exists: true, $ne: '' }
    });

    // Check SMS credits
    const creditCheck = await checkSmsCredits(merchantId, memberCount);
    if (!creditCheck.allowed) {
      return res.status(403).json({
        error: `Insufficient SMS credits. You need ${creditCheck.required} credit(s) but only have ${creditCheck.currentBalance}`,
        code: 'INSUFFICIENT_SMS_CREDITS',
        currentBalance: creditCheck.currentBalance,
        required: creditCheck.required,
        shortfall: creditCheck.shortfall,
        recipientCount: memberCount,
      });
    }

    const result = await smsService.sendToDepartment({
      departmentId,
      message,
      merchantId,
      userId,
      category: category || 'general',
      branchId: req.user.currentBranch
    });

    res.json({
      success: result.success,
      message: `SMS sent to ${result.successCount} of ${result.recipientCount} department members`,
      smsLogId: result.smsLog._id,
      recipientCount: result.recipientCount,
      successCount: result.successCount,
      failCount: result.failCount,
      creditsUsed: result.creditsUsed
    });
  } catch (error) {
    console.error('Send to department error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Send to all members
export const sendToAllMembers = async (req, res) => {
  try {
    const merchantId = req.user.organizationId;
    const userId = req.user.userId;
    const { message, category } = req.body;

    if (!merchantId) {
      return res.status(400).json({ error: 'User organization not found. Please ensure your account is properly configured.' });
    }

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Count all organization members
    const memberCount = await Member.countDocuments({
      organization: merchantId,
      phoneNumber: { $exists: true, $ne: '' }
    });

    // Check SMS credits
    const creditCheck = await checkSmsCredits(merchantId, memberCount);
    if (!creditCheck.allowed) {
      return res.status(403).json({
        error: `Insufficient SMS credits. You need ${creditCheck.required} credit(s) but only have ${creditCheck.currentBalance}`,
        code: 'INSUFFICIENT_SMS_CREDITS',
        currentBalance: creditCheck.currentBalance,
        required: creditCheck.required,
        shortfall: creditCheck.shortfall,
        recipientCount: memberCount,
      });
    }

    const result = await smsService.sendToAllMembers({
      message,
      merchantId,
      userId,
      category: category || 'general',
      branchId: req.user.currentBranch
    });

    res.json({
      success: result.success,
      message: `SMS sent to ${result.successCount} of ${result.recipientCount} members`,
      recipientCount: result.recipientCount,
      successCount: result.successCount,
      failCount: result.failCount,
      creditsUsed: result.creditsUsed
    });
  } catch (error) {
    console.error('Send to all members error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Get SMS logs
export const getSmsLogs = async (req, res) => {
  try {
    const merchantId = req.user.organizationId;
    const { 
      page = 1, 
      limit = 20, 
      status, 
      category, 
      startDate, 
      endDate,
      messageType 
    } = req.query;

    const query = { merchantId };

    if (status) query.overallStatus = status;
    if (category) query.category = category;
    if (messageType) query.messageType = messageType;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    console.log('📋 [getSmsLogs] Query:', JSON.stringify(query));
    console.log('📋 [getSmsLogs] MerchantId:', merchantId);

    const total = await SmsLog.countDocuments(query);
    console.log('📋 [getSmsLogs] Total logs found:', total);

    const logs = await SmsLog.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .populate('sentBy', 'firstName lastName email')
      .lean();

    console.log('📋 [getSmsLogs] Returning', logs.length, 'logs');

    // Add stats to each log
    const logsWithStats = logs.map(log => ({
      ...log,
      stats: {
        total: log.totalRecipients,
        delivered: log.successfulDeliveries || 0,
        failed: log.failedDeliveries || 0,
        pending: log.recipients.filter(r => r.status === 'pending' || r.status === 'submitted').length,
        deliveryRate: log.totalRecipients > 0 
          ? ((log.successfulDeliveries || 0) / log.totalRecipients * 100).toFixed(2)
          : 0
      }
    }));

    res.json({
      logs: logsWithStats,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get SMS logs error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Get single SMS log details
export const getSmsLogDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const merchantId = req.user.organizationId;

    const log = await SmsLog.findOne({ _id: id, merchantId })
      .populate('sentBy', 'firstName lastName email')
      .lean();

    if (!log) {
      return res.status(404).json({ error: 'SMS log not found' });
    }

    const stats = {
      total: log.totalRecipients,
      delivered: log.successfulDeliveries || 0,
      failed: log.failedDeliveries || 0,
      pending: log.recipients.filter(r => r.status === 'pending' || r.status === 'submitted').length,
      deliveryRate: log.totalRecipients > 0 
        ? ((log.successfulDeliveries || 0) / log.totalRecipients * 100).toFixed(2)
        : 0
    };

    res.json({
      ...log,
      stats
    });
  } catch (error) {
    console.error('Get SMS log details error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Get SMS analytics
export const getSmsAnalytics = async (req, res) => {
  try {
    const merchantId = req.user.organizationId;
    const { startDate, endDate, period = '30d' } = req.query;

    // Calculate date range
    let dateQuery = {};
    if (startDate && endDate) {
      dateQuery = {
        createdAt: {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        }
      };
    } else {
      const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
      dateQuery = {
        createdAt: {
          $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000)
        }
      };
    }

    const logs = await SmsLog.find({ merchantId, ...dateQuery });

    const analytics = {
      totalSent: logs.reduce((sum, log) => sum + log.totalRecipients, 0),
      totalDelivered: logs.reduce((sum, log) => sum + (log.successfulDeliveries || 0), 0),
      totalFailed: logs.reduce((sum, log) => sum + (log.failedDeliveries || 0), 0),
      totalCreditsUsed: logs.reduce((sum, log) => sum + log.creditsUsed, 0),
      totalCampaigns: logs.length,
      deliveryRate: 0,
      byCategory: {},
      byType: {},
      timeline: []
    };

    // Calculate delivery rate
    if (analytics.totalSent > 0) {
      analytics.deliveryRate = (analytics.totalDelivered / analytics.totalSent * 100).toFixed(2);
    }

    // Group by category
    logs.forEach(log => {
      if (!analytics.byCategory[log.category]) {
        analytics.byCategory[log.category] = { count: 0, sent: 0, delivered: 0, credits: 0 };
      }
      analytics.byCategory[log.category].count++;
      analytics.byCategory[log.category].sent += log.totalRecipients;
      analytics.byCategory[log.category].delivered += log.successfulDeliveries || 0;
      analytics.byCategory[log.category].credits += log.creditsUsed;
    });

    // Group by type
    logs.forEach(log => {
      if (!analytics.byType[log.messageType]) {
        analytics.byType[log.messageType] = { count: 0, sent: 0, delivered: 0 };
      }
      analytics.byType[log.messageType].count++;
      analytics.byType[log.messageType].sent += log.totalRecipients;
      analytics.byType[log.messageType].delivered += log.successfulDeliveries || 0;
    });

    res.json(analytics);
  } catch (error) {
    console.error('Get SMS analytics error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Get available members for SMS
export const getAvailableMembers = async (req, res) => {
  try {
    const merchantId = req.user.organizationId;
    const branchId = req.user.currentBranch;

    const query = {
      merchant: merchantId,
      status: 'active',
      phone: { $exists: true, $ne: '' }
    };

    if (branchId) {
      query.branch = branchId;
    }

    const members = await Member.find(query)
      .select('firstName lastName phone email department')
      .populate('department', 'name')
      .lean();

    res.json({
      members,
      count: members.length
    });
  } catch (error) {
    console.error('Get available members error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Calculate SMS cost preview
export const calculateSmsCost = async (req, res) => {
  try {
    const { message, recipientCount } = req.body;

    if (!message || !recipientCount) {
      return res.status(400).json({ error: 'Message and recipient count are required' });
    }

    const credits = smsService.calculateCredits(message, recipientCount);
    const messageLength = message.length;
    const segments = messageLength <= 160 ? 1 : Math.ceil(messageLength / 153);

    res.json({
      creditsNeeded: credits,
      messageLength,
      segments,
      recipientCount,
      creditsPerRecipient: segments
    });
  } catch (error) {
    console.error('Calculate SMS cost error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Update delivery status for a specific SMS log
export const updateDeliveryStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const merchantId = req.user.organizationId;

    // Verify the log belongs to this organization
    const log = await SmsLog.findOne({ _id: id, merchantId });
    if (!log) {
      return res.status(404).json({ error: 'SMS log not found' });
    }

    const result = await smsService.updateDeliveryStatuses(id);
    
    res.json({
      success: true,
      message: 'Delivery statuses updated',
      ...result
    });
  } catch (error) {
    console.error('Update delivery status error:', error);
    res.status(500).json({ error: error.message });
  }
};

// Batch update delivery statuses for multiple logs
export const batchUpdateDeliveryStatuses = async (req, res) => {
  try {
    const { logIds } = req.body;
    const merchantId = req.user.organizationId;

    if (!logIds || !Array.isArray(logIds) || logIds.length === 0) {
      return res.status(400).json({ error: 'Valid log IDs array is required' });
    }

    // Verify all logs belong to this organization
    const logs = await SmsLog.find({ _id: { $in: logIds }, merchantId });
    if (logs.length !== logIds.length) {
      return res.status(404).json({ error: 'One or more SMS logs not found' });
    }

    const result = await smsService.batchUpdateDeliveryStatuses(logIds);
    
    res.json({
      success: true,
      message: 'Batch delivery statuses updated',
      ...result
    });
  } catch (error) {
    console.error('Batch update delivery statuses error:', error);
    res.status(500).json({ error: error.message });
  }
};
