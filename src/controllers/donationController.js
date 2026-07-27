import Donation from '../models/Donation.js';
import Organization from '../models/Organization.js';
import Transaction from '../models/Transaction.js';
import { branchFilter, resolveCreateBranch } from '../utils/branchQuery.js';
import resend, { hasEmailConfig, EMAIL_FROM } from '../config/email.js';
import { checkDonationLimit } from '../utils/usageLimits.js';
import smsService from '../services/smsService.js';

export const getAllDonations = async (req, res) => {
  try {
    const { startDate, endDate, donationType, fundBucketId, paymentMethod, page, limit } = req.query;

    const filter = branchFilter(req);
    if (startDate || endDate) {
      filter.donationDate = {};
      if (startDate) filter.donationDate.$gte = new Date(startDate);
      if (endDate) filter.donationDate.$lte = new Date(endDate);
    }
    if (donationType) filter.donationType = donationType;
    if (fundBucketId) filter.fundBucketId = fundBucketId;
    if (paymentMethod) filter.paymentMethod = paymentMethod;

    // Pagination is opt-in (page/limit present) so existing unpaginated
    // callers keep getting a plain array back.
    if (page || limit) {
      const pageNum = Math.max(1, parseInt(page) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
      const skip = (pageNum - 1) * limitNum;

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthFilter = { ...branchFilter(req), donationDate: { $gte: monthStart } };
      if (donationType) monthFilter.donationType = donationType;
      if (fundBucketId) monthFilter.fundBucketId = fundBucketId;
      if (paymentMethod) monthFilter.paymentMethod = paymentMethod;

      const [donations, total, totals, monthTotals] = await Promise.all([
        Donation.find(filter)
          .populate('donorId', 'firstName lastName email')
          .populate('fundBucketId', 'name targetAmount targetDate status')
          .populate('offeringTypeId', 'name')
          .populate('eventId', 'title startDate')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum),
        Donation.countDocuments(filter),
        Donation.aggregate([
          { $match: filter },
          { $group: { _id: null, totalAmount: { $sum: '$amount' } } },
        ]),
        Donation.aggregate([
          { $match: monthFilter },
          { $group: { _id: null, totalAmount: { $sum: '$amount' } } },
        ]),
      ]);

      const totalAmount = totals[0]?.totalAmount || 0;

      return res.json({
        donations,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
        totalAmount,
        averageAmount: total > 0 ? totalAmount / total : 0,
        monthlyTotal: monthTotals[0]?.totalAmount || 0,
      });
    }

    const donations = await Donation.find(filter)
      .populate('donorId', 'firstName lastName email')
      .populate('fundBucketId', 'name targetAmount targetDate status')
      .populate('offeringTypeId', 'name')
      .populate('eventId', 'title startDate')
      .sort({ createdAt: -1 });
    res.json(donations);
  } catch (error) {
    console.error('Error fetching donations:', error);
    res.status(500).json({ error: 'Failed to fetch donations' });
  }
};

export const getDonationById = async (req, res) => {
  try {
    const { id } = req.params;
    const donation = await Donation.findOne({ _id: id, ...branchFilter(req) })
      .populate('donorId', 'firstName lastName email')
      .populate('fundBucketId', 'name targetAmount targetDate status')
      .populate('offeringTypeId', 'name')
      .populate('eventId', 'title startDate');

    if (!donation) {
      return res.status(404).json({ error: 'Donation not found' });
    }

    res.json(donation);
  } catch (error) {
    console.error('Error fetching donation:', error);
    res.status(500).json({ error: 'Failed to fetch donation' });
  }
};

export const createDonation = async (req, res) => {
  try {
    const { donorId, donorType, amount, donationType, donationDate, paymentMethod, transactionId, notes, fundBucketId, offeringTypeId, eventId, donorName, donorEmail, donorPhone, chequeNumber, paymentAttachmentUrl, paymentAttachmentName, paidForMonth } = req.body;

    console.log('📥 createDonation received:', {
      donorId,
      donorType,
      donorName,
      amount,
      donationType,
    });

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than 0' });
    }

    if (paymentMethod === 'cheque' && !chequeNumber) {
      return res.status(400).json({ error: 'Cheque number is required for cheque payments' });
    }

    if (paymentMethod === 'bank_transfer' && !paymentAttachmentUrl) {
      return res.status(400).json({ error: 'A proof-of-transfer attachment is required for bank transfer payments' });
    }

    const branchId = resolveCreateBranch(req);
    if (!branchId) {
      return res.status(400).json({ error: 'Branch is required' });
    }

    // Check donation transaction limit
    const limitCheck = await checkDonationLimit(req.organizationId);
    if (!limitCheck.allowed) {
      return res.status(403).json({
        error: `Donation transaction limit reached for this month. Current: ${limitCheck.current}/${limitCheck.limit}`,
        code: 'DONATION_LIMIT_EXCEEDED',
        current: limitCheck.current,
        limit: limitCheck.limit,
      });
    }

    const donationData = {
      organizationId: req.organizationId,
      branchId,
      amount,
      donationType,
      donationDate,
      paymentMethod,
      transactionId,
      notes,
      fundBucketId: fundBucketId || undefined,
      offeringTypeId: offeringTypeId || undefined,
      eventId: eventId || undefined,
      donorType: ['member', 'guest', 'collective'].includes(donorType) ? donorType : 'member',
      paidForMonth: paidForMonth || undefined,
      chequeNumber: paymentMethod === 'cheque' ? chequeNumber : undefined,
      paymentAttachmentUrl: paymentMethod === 'bank_transfer' ? paymentAttachmentUrl : undefined,
      paymentAttachmentName: paymentMethod === 'bank_transfer' ? paymentAttachmentName : undefined,
    };

    // Handle donorId - accept if it exists and is not empty (never set for collective)
    if (donorId && donationData.donorType !== 'collective') {
      const trimmedDonorId = typeof donorId === 'string' ? donorId.trim() : donorId;
      if (trimmedDonorId) {
        donationData.donorId = trimmedDonorId;
        console.log('✅ Setting donorId:', trimmedDonorId);
      }
    } else {
      console.log('⚠️ donorId is missing or falsy:', donorId);
    }

    // Add donor info for guest donations, or the gathering description for collective ones
    if (donorName) donationData.donorName = donorName;
    if (donationData.donorType === 'guest') {
      if (donorEmail) donationData.donorEmail = donorEmail;
      if (donorPhone) donationData.donorPhone = donorPhone;
    }

    console.log('📝 Donation data before save:', JSON.stringify(donationData, null, 2));

    const donation = new Donation(donationData);

    await donation.save();

    console.log('💾 Saved donation:', {
      _id: donation._id,
      donorId: donation.donorId,
      amount: donation.amount,
      donationType: donation.donationType,
    });

    // Record in unified transaction ledger
    await Transaction.create({
      organizationId: req.organizationId,
      branchId,
      type: 'donation',
      direction: 'inflow',
      amount,
      currency: 'GHS',
      status: 'completed',
      paymentMethod,
      providerReference: transactionId,
      relatedModel: 'Donation',
      relatedId: donation._id,
      description: `${donationType || 'General'} donation`,
      initiatedBy: req.user.userId,
      metadata: { donorId, donationType, fundBucketId, offeringTypeId },
    });

    // Populate references before returning (so frontend doesn't show "Anonymous")
    await donation.populate('donorId', 'firstName lastName email');
    await donation.populate('fundBucketId', 'name targetAmount targetDate status');
    await donation.populate('offeringTypeId', 'name');
    await donation.populate('eventId', 'title startDate');

    res.status(201).json(donation);
  } catch (error) {
    console.error('Error creating donation:', error.message, error.stack);
    res.status(500).json({
      error: 'Failed to create donation',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

export const updateDonation = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body, updatedAt: Date.now() };
    delete updates._id;
    delete updates.organizationId;
    delete updates.branchId;

    // Edit forms submit the whole record, including cheque/attachment fields
    // left over from a payment method that's since been switched away from —
    // strip whichever doesn't match the (possibly just-changed) paymentMethod.
    if ('paymentMethod' in updates) {
      if (updates.paymentMethod === 'cheque' && !updates.chequeNumber) {
        return res.status(400).json({ error: 'Cheque number is required for cheque payments' });
      }
      if (updates.paymentMethod === 'bank_transfer' && !updates.paymentAttachmentUrl) {
        return res.status(400).json({ error: 'A proof-of-transfer attachment is required for bank transfer payments' });
      }
      // Explicit null (not undefined) so it's actually written and clears
      // any stale value from before the payment method was switched —
      // undefined keys get silently dropped by the BSON serializer.
      if (updates.paymentMethod !== 'cheque') updates.chequeNumber = null;
      if (updates.paymentMethod !== 'bank_transfer') {
        updates.paymentAttachmentUrl = null;
        updates.paymentAttachmentName = null;
      }
    }

    const donation = await Donation.findOneAndUpdate(
      { _id: id, ...branchFilter(req) },
      updates,
      { new: true }
    );

    if (!donation) {
      return res.status(404).json({ error: 'Donation not found' });
    }

    // Keep the ledger entry in sync (mirrors the same fix on expenses)
    await Transaction.findOneAndUpdate(
      { relatedModel: 'Donation', relatedId: donation._id },
      {
        amount: donation.amount,
        paymentMethod: donation.paymentMethod,
        description: `${donation.donationType || 'General'} donation`,
      }
    );

    // Populate references before returning
    await donation.populate('donorId', 'firstName lastName email');
    await donation.populate('fundBucketId', 'name targetAmount targetDate status');
    await donation.populate('offeringTypeId', 'name');
    await donation.populate('eventId', 'title startDate');

    res.json(donation);
  } catch (error) {
    console.error('Error updating donation:', error);
    res.status(500).json({ error: 'Failed to update donation' });
  }
};

export const getDonationStats = async (req, res) => {
  try {
    const stats = await Donation.aggregate([
      { $match: branchFilter(req) },
      {
        $group: {
          _id: {
            donationType: '$donationType',
            month: { $dateToString: { format: '%Y-%m', date: '$donationDate' } },
          },
          totalDonations: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          averageDonation: { $avg: '$amount' },
          largestDonation: { $max: '$amount' },
        },
      },
      {
        $project: {
          _id: 0,
          donationType: '$_id.donationType',
          month: '$_id.month',
          totalDonations: 1,
          totalAmount: 1,
          averageDonation: { $round: ['$averageDonation', 2] },
          largestDonation: 1,
        },
      },
      { $sort: { month: -1 } },
    ]);

    res.json(stats);
  } catch (error) {
    console.error('Error fetching donation stats:', error);
    res.status(500).json({ error: 'Failed to fetch donation stats' });
  }
};

export const sendReceipt = async (req, res) => {
  try {
    const { id } = req.params;
    const { channel } = req.body; // 'email' or 'sms'

    const donation = await Donation.findOne({ _id: id, ...branchFilter(req) })
      .populate('donorId', 'firstName lastName email phone')
      .populate('fundBucketId', 'name');

    if (!donation) {
      return res.status(404).json({ error: 'Donation not found' });
    }

    if (!donation.donorId) {
      return res.status(400).json({ error: 'Cannot send receipt for anonymous donation' });
    }

    const org = await Organization.findById(req.organizationId);
    const churchName = org?.churchName || 'Church';
    const donorName = `${donation.donorId.firstName} ${donation.donorId.lastName}`;
    const amount = donation.amount.toLocaleString(undefined, { minimumFractionDigits: 2 });
    const date = new Date(donation.donationDate).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });

    if (channel === 'email') {
      if (!hasEmailConfig) {
        return res.status(503).json({ error: 'Email is not configured' });
      }

      const recipientEmail = donation.donorId.email;
      if (!recipientEmail) {
        return res.status(400).json({ error: 'Donor does not have an email address' });
      }

      const { error } = await resend.emails.send({
        from: EMAIL_FROM,
        to: [recipientEmail],
        subject: `Donation Receipt - ${churchName}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Donation Receipt</h2>
            <p>Dear ${donorName},</p>
            <p>Thank you for your generous donation to <strong>${churchName}</strong>.</p>
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
              <tr><td style="padding: 8px; border-bottom: 1px solid #eee; color: #666;">Date</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${date}</td></tr>
              <tr><td style="padding: 8px; border-bottom: 1px solid #eee; color: #666;">Amount</td><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">GHS ${amount}</td></tr>
              <tr><td style="padding: 8px; border-bottom: 1px solid #eee; color: #666;">Type</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${donation.donationType || 'General'}</td></tr>
              <tr><td style="padding: 8px; border-bottom: 1px solid #eee; color: #666;">Payment Method</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${donation.paymentMethod?.replace('_', ' ') || 'N/A'}</td></tr>
              ${donation.fundBucketId ? `<tr><td style="padding: 8px; border-bottom: 1px solid #eee; color: #666;">Fund</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${donation.fundBucketId.name}</td></tr>` : ''}
            </table>
            <p style="color: #666; font-size: 14px;">God bless you for your generosity.</p>
            <p style="color: #999; font-size: 12px;">This receipt was generated by ${churchName} via Sanctuary Connect.</p>
          </div>
        `,
        text: `Donation Receipt\n\nDear ${donorName},\n\nThank you for your donation to ${churchName}.\n\nDate: ${date}\nAmount: GHS ${amount}\nType: ${donation.donationType || 'General'}\nPayment: ${donation.paymentMethod?.replace('_', ' ') || 'N/A'}\n\nGod bless you.`,
      });

      if (error) {
        throw new Error(error.message);
      }

      res.json({ message: `Receipt sent to ${recipientEmail}` });
    } else if (channel === 'sms') {
      const recipientPhone = donation.donorId.phone;
      if (!recipientPhone) {
        return res.status(400).json({ error: 'Donor does not have a phone number' });
      }

      const message = `Thank you ${donorName}! ${churchName} received your ${donation.donationType || 'donation'} of GHS ${amount} on ${date}. God bless you.`;

      const result = await smsService.sendSingle({
        phone: recipientPhone,
        message,
        merchantId: req.organizationId,
        userId: req.user?.userId,
        category: 'thank_you',
        metadata: { recipientName: donorName, memberId: donation.donorId._id },
      });

      if (!result.success) {
        return res.status(502).json({ error: 'SMS receipt could not be delivered. Please try again.' });
      }

      res.json({ message: `Receipt sent to ${recipientPhone}` });
    } else {
      res.status(400).json({ error: 'Invalid channel. Use "email" or "sms".' });
    }
  } catch (error) {
    console.error('Error sending receipt:', error);
    res.status(500).json({ error: error.message || 'Failed to send receipt' });
  }
};

export default {
  getAllDonations,
  getDonationById,
  createDonation,
  updateDonation,
  getDonationStats,
  sendReceipt,
};
