import Donation from '../models/Donation.js';
import Organization from '../models/Organization.js';
import Transaction from '../models/Transaction.js';
import { branchFilter, resolveCreateBranch } from '../utils/branchQuery.js';
import transporter, { hasEmailConfig } from '../config/email.js';
import { checkDonationLimit } from '../utils/usageLimits.js';

export const getAllDonations = async (req, res) => {
  try {
    const donations = await Donation.find(branchFilter(req))
      .populate('donorId', 'firstName lastName email')
      .populate('fundBucketId', 'name')
      .sort({ donationDate: -1 });
    res.json(donations);
  } catch (error) {
    console.error('Error fetching donations:', error);
    res.status(500).json({ error: 'Failed to fetch donations' });
  }
};

export const getDonationById = async (req, res) => {
  try {
    const { id } = req.params;
    const donation = await Donation.findById(id)
      .populate('donorId', 'firstName lastName email')
      .populate('fundBucketId', 'name');

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
    const { donorId, amount, donationType, donationDate, paymentMethod, transactionId, notes, fundBucketId } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than 0' });
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

    const donation = new Donation({
      organizationId: req.organizationId,
      branchId,
      donorId,
      amount,
      donationType,
      donationDate,
      paymentMethod,
      transactionId,
      notes,
      fundBucketId,
    });

    await donation.save();

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
      metadata: { donorId, donationType, fundBucketId },
    });

    res.status(201).json(donation);
  } catch (error) {
    console.error('Error creating donation:', error);
    res.status(500).json({ error: 'Failed to create donation' });
  }
};

export const updateDonation = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body, updatedAt: Date.now() };
    delete updates._id;
    delete updates.organizationId;
    delete updates.branchId;

    const donation = await Donation.findByIdAndUpdate(id, updates, { new: true });

    if (!donation) {
      return res.status(404).json({ error: 'Donation not found' });
    }

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

    const donation = await Donation.findById(id)
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

      await transporter.sendMail({
        from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
        to: recipientEmail,
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

      res.json({ message: `Receipt sent to ${recipientEmail}` });
    } else if (channel === 'sms') {
      // SMS would require SMS gateway integration
      res.status(501).json({ error: 'SMS receipts are not yet available. Coming soon.' });
    } else {
      res.status(400).json({ error: 'Invalid channel. Use "email" or "sms".' });
    }
  } catch (error) {
    console.error('Error sending receipt:', error);
    res.status(500).json({ error: 'Failed to send receipt' });
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
